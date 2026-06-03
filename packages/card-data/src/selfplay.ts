import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  EFFECTS,
  activeApCount,
  applyIntent,
  beginFirstTurn,
  createGame,
  energyPool,
  hasRequiredEnergy,
  nextRng,
  opponentOf,
  shuffle,
  validateDeck,
  type CardDef,
  type GameState,
  type Intent,
  type Seat,
} from "@union-arena/core";
import { toCardDef } from "./mapper.js";
import { canonicalPlayableCards, groupCardsByProduct, isApCard, productGroupKey } from "./normalize.js";
import { CardSetSchema, RawCardSchema, type RawCard } from "./schema.js";

export interface SelfPlayStep {
  step: number;
  seat: Seat;
  intent: Intent;
}

export interface SelfPlayFailure {
  seed: number;
  productCode?: string;
  step: number;
  reason: string;
  lastIntent?: Intent;
  transcript: SelfPlayStep[];
}

export interface SelfPlayOk {
  ok: true;
  seed: number;
  productCode: string;
  steps: number;
  transcript: SelfPlayStep[];
}

export type SelfPlayResult = SelfPlayOk | ({ ok: false } & SelfPlayFailure);

export interface SelfPlayOptions {
  setsDir: string;
  seed?: number;
  productCode?: string;
  maxSteps?: number;
  biasEffects?: boolean;
}

interface ProductPool {
  productCode: string;
  defs: Record<string, CardDef>;
  cards: CardDef[];
  apCardId: string;
}

type InstanceLocation =
  | { kind: "zone"; seat: Seat; zone: keyof GameState["players"][Seat] }
  | { kind: "pendingTrigger"; seat: Seat }
  | { kind: "under"; topIid: string };

const ZONES = [
  "deck",
  "hand",
  "frontLine",
  "energyLine",
  "life",
  "ap",
  "sideline",
  "removal",
] as const;

function choose<T>(items: readonly T[], seed: number): { item: T; seed: number } {
  const r = nextRng(seed);
  return { item: items[Math.floor(r.value * items.length)]!, seed: r.state };
}

function shuffled<T>(items: readonly T[], seed: number): { items: T[]; seed: number } {
  const result = shuffle(items, seed);
  return { items: result.result, seed: result.state };
}

function loadRawCards(setsDir: string): RawCard[] {
  const raws: RawCard[] = [];
  for (const file of readdirSync(setsDir).filter((name) => name.endsWith(".json")).sort()) {
    const parsed = CardSetSchema.parse(JSON.parse(readFileSync(resolve(setsDir, file), "utf8")));
    for (const rawJson of parsed.cards) raws.push(RawCardSchema.parse(rawJson));
  }
  return raws;
}

function buildProductPools(setsDir: string): ProductPool[] {
  const rawByProduct = groupCardsByProduct(loadRawCards(setsDir));
  const pools: ProductPool[] = [];

  for (const [productCode, raws] of [...rawByProduct.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const apRaw = raws.find(isApCard);
    if (!apRaw) continue;

    const cards = canonicalPlayableCards(raws).map(toCardDef);
    if (cards.length === 0) continue;

    const apDef = toCardDef(apRaw);
    const defs: Record<string, CardDef> = { [apDef.id]: apDef };
    for (const card of cards) defs[card.id] = card;
    pools.push({ productCode, defs, cards, apCardId: apDef.id });
  }

  return pools;
}

function makeSelfPlayDeck(pool: ProductPool, seed: number): string[] | null {
  const deck: string[] = [];
  const byNumber = new Map<string, number>();
  const cappedTriggers = new Map<string, number>();
  const sorted = [...pool.cards].sort((a, b) => {
    const energyA = a.energyGeneration.reduce((sum, e) => sum + e.amount, 0);
    const energyB = b.energyGeneration.reduce((sum, e) => sum + e.amount, 0);
    return energyB - energyA || a.apCost - b.apCost || a.cardNumber.localeCompare(b.cardNumber);
  });
  const order = shuffled(sorted, seed).items;

  let pass = 0;
  while (deck.length < 50 && pass < 4) {
    for (const card of order) {
      if (deck.length >= 50) break;
      const copies = byNumber.get(card.cardNumber) ?? 0;
      if (copies >= 4) continue;
      if (
        card.hasTrigger &&
        card.triggerType &&
        ["special", "color", "final"].includes(card.triggerType) &&
        (cappedTriggers.get(card.triggerType) ?? 0) >= 4
      ) {
        continue;
      }
      deck.push(card.id);
      byNumber.set(card.cardNumber, copies + 1);
      if (card.hasTrigger && card.triggerType && ["special", "color", "final"].includes(card.triggerType)) {
        cappedTriggers.set(card.triggerType, (cappedTriggers.get(card.triggerType) ?? 0) + 1);
      }
    }
    pass++;
  }

  if (deck.length !== 50) return null;
  return validateDeck(deck, pool.defs).ok ? deck : null;
}

function requiredActor(state: GameState): Seat {
  if (state.pendingTriggers) return state.pendingTriggers.seat;
  if (state.pendingAttack) return opponentOf(state.activeSeat);
  return state.activeSeat;
}

function def(state: GameState, iid: string): CardDef {
  return state.defs[state.instances[iid]!.defId]!;
}

function firstLifeTargets(state: GameState, seat: Seat, amount = 1): string[] {
  return state.players[seat].life.slice(0, amount);
}

function damageAmount(state: GameState): number {
  if (!state.pendingAttack) return 1;
  const attacker = def(state, state.pendingAttack.attackerIid);
  return Math.max(1, attacker.impactN ?? 1);
}

function triggerCandidates(state: GameState): Intent[] {
  const pending = state.pendingTriggers;
  if (!pending) return [];
  const seat = pending.seat;
  const iid = pending.iids[0]!;
  const card = def(state, iid);
  const own = state.players[seat];
  const opp = state.players[opponentOf(seat)];
  const base = { type: "resolveTrigger" as const, seat, iid, activate: true };

  const candidates: Intent[] = [];
  switch (card.triggerType) {
    case "active":
      for (const targetIid of own.frontLine) candidates.push({ ...base, targetIid });
      break;
    case "special":
      for (const targetIid of opp.frontLine) candidates.push({ ...base, targetIid });
      break;
    case "color":
      if (card.color === "red" || card.color === "blue") {
        for (const targetIid of opp.frontLine) candidates.push({ ...base, targetIid });
      }
      if (card.color === "green") {
        for (const playIid of own.hand) candidates.push({ ...base, playIid });
      }
      if (card.color === "purple") {
        for (const playIid of own.sideline) candidates.push({ ...base, playIid });
      }
      break;
    case "raid":
      for (const targetIid of [...own.frontLine, ...own.energyLine]) {
        candidates.push({ ...base, targetIid });
      }
      break;
    case "draw":
    case "final":
    case "get":
      candidates.push(base);
      break;
  }
  candidates.push({ type: "resolveTrigger", seat, iid, activate: false });
  return candidates;
}

function attackResponseCandidates(state: GameState): Intent[] {
  const pending = state.pendingAttack;
  if (!pending) return [];
  const seat = opponentOf(state.activeSeat);
  const player = state.players[seat];
  const lifeIids = firstLifeTargets(state, seat, Math.min(damageAmount(state), player.life.length));
  const candidates: Intent[] = [];

  if (pending.targetIid === undefined) {
    for (const blockerIid of player.frontLine) {
      if (state.instances[blockerIid]?.orientation === "active") {
        candidates.push({ type: "declareBlock", seat, blockerIid, ...(lifeIids.length ? { lifeIids } : {}) });
      }
    }
  }
  candidates.push({ type: "declareBlock", seat, ...(lifeIids.length ? { lifeIids } : {}) });
  return candidates;
}

function mainPhaseCandidates(state: GameState, seat: Seat): Intent[] {
  const player = state.players[seat];
  const candidates: Intent[] = [];
  const field = [...player.frontLine, ...player.energyLine];

  for (const iid of field) {
    const card = def(state, iid);
    for (const effectId of card.effectIds) {
      if (EFFECTS[effectId]?.when === "activate") {
        candidates.push({ type: "activateAbility", seat, iid, effectId });
      }
    }
  }

  for (const iid of player.hand) {
    const card = def(state, iid);
    if (card.type === "event") {
      candidates.push({ type: "useEvent", seat, iid });
      continue;
    }
    if (card.keywords.includes("raid")) {
      for (const targetIid of field) {
        const target = def(state, targetIid);
        if (target.type === "character" && !target.keywords.includes("raid") && state.instances[targetIid]!.raidUnder.length === 0) {
          candidates.push({ type: "raid", seat, iid, targetIid });
          if (player.energyLine.includes(targetIid)) candidates.push({ type: "raid", seat, iid, targetIid, moveToFront: true });
        }
      }
    }
    if (hasRequiredEnergy(state, seat, card) && activeApCount(state, seat) >= card.apCost) {
      if (card.type === "site") candidates.push({ type: "playCard", seat, iid, to: "energyLine" });
      else {
        candidates.push({ type: "playCard", seat, iid, to: "frontLine" });
        candidates.push({ type: "playCard", seat, iid, to: "energyLine" });
      }
    }
  }

  candidates.push({ type: "advancePhase", seat });
  return candidates;
}

function movementCandidates(state: GameState, seat: Seat): Intent[] {
  const player = state.players[seat];
  const candidates: Intent[] = [];
  for (const iid of player.energyLine) {
    if (def(state, iid).type === "character") candidates.push({ type: "move", seat, iid, to: "frontLine" });
  }
  for (const iid of player.frontLine) {
    if (def(state, iid).keywords.includes("step")) candidates.push({ type: "move", seat, iid, to: "energyLine" });
  }
  candidates.push({ type: "advancePhase", seat });
  return candidates;
}

function attackPhaseCandidates(state: GameState, seat: Seat): Intent[] {
  const player = state.players[seat];
  const opp = state.players[opponentOf(seat)];
  const candidates: Intent[] = [];
  for (const attackerIid of player.frontLine) {
    if (state.instances[attackerIid]?.orientation !== "active") continue;
    const card = def(state, attackerIid);
    if (card.keywords.includes("snipe")) {
      for (const targetIid of opp.frontLine) candidates.push({ type: "declareAttack", seat, attackerIid, targetIid });
    }
    candidates.push({ type: "declareAttack", seat, attackerIid });
  }
  candidates.push({ type: "advancePhase", seat });
  return candidates;
}

function candidatesFor(state: GameState): Intent[] {
  if (state.pendingTriggers) return triggerCandidates(state);
  if (state.pendingAttack) return attackResponseCandidates(state);

  const seat = state.activeSeat;
  switch (state.phase) {
    case "start":
      return [
        { type: "extraDraw", seat },
        { type: "advancePhase", seat },
      ];
    case "movement":
      return movementCandidates(state, seat);
    case "main":
      return mainPhaseCandidates(state, seat);
    case "attack":
      return attackPhaseCandidates(state, seat);
    case "end":
      return [
        { type: "advancePhase", seat },
        { type: "endTurn", seat },
      ];
  }
}

function isEffectBiasedIntent(intent: Intent): boolean {
  switch (intent.type) {
    case "activateAbility":
    case "useEvent":
    case "raid":
      return true;
    case "resolveTrigger":
      return intent.activate;
    default:
      return false;
  }
}

function orderCandidates(candidates: Intent[], seed: number, biasEffects: boolean): { items: Intent[]; seed: number } {
  if (!biasEffects) return shuffled(candidates, seed);

  const preferred = candidates.filter(isEffectBiasedIntent);
  const fallback = candidates.filter((intent) => !isEffectBiasedIntent(intent));
  const shuffledPreferred = shuffled(preferred, seed);
  const shuffledFallback = shuffled(fallback, shuffledPreferred.seed);
  return { items: [...shuffledPreferred.items, ...shuffledFallback.items], seed: shuffledFallback.seed };
}

function describeLocation(location: InstanceLocation): string {
  switch (location.kind) {
    case "zone":
      return `${location.seat}.${String(location.zone)}`;
    case "pendingTrigger":
      return `${location.seat}.pendingTriggers`;
    case "under":
      return `under ${location.topIid}`;
  }
}

function addLocation(
  locations: Map<string, InstanceLocation[]>,
  iid: string,
  location: InstanceLocation,
): void {
  const list = locations.get(iid) ?? [];
  list.push(location);
  locations.set(iid, list);
}

/**
 * Validate coarse engine invariants that should hold after every accepted intent.
 *
 * This intentionally checks state shape, not game strategy. It is meant to catch
 * reducer corruption quickly: duplicate cards, orphan cards, bad pending refs,
 * and line overflow.
 */
export function validateSelfPlayInvariants(state: GameState): string[] {
  const errors: string[] = [];
  const locations = new Map<string, InstanceLocation[]>();

  for (const seat of ["p1", "p2"] as const) {
    const player = state.players[seat];
    for (const zone of ZONES) {
      for (const iid of player[zone]) {
        if (!state.instances[iid]) {
          errors.push(`${seat}.${zone} references missing instance ${iid}.`);
          continue;
        }
        addLocation(locations, iid, { kind: "zone", seat, zone });
      }
    }

    if (player.frontLine.length > 4) {
      errors.push(`${seat}.frontLine has ${player.frontLine.length} cards.`);
    }
    if (player.energyLine.length > 4) {
      errors.push(`${seat}.energyLine has ${player.energyLine.length} cards.`);
    }
  }

  if (state.pendingTriggers) {
    for (const iid of state.pendingTriggers.iids) {
      if (!state.instances[iid]) {
        errors.push(`pending trigger references missing instance ${iid}.`);
        continue;
      }
      addLocation(locations, iid, { kind: "pendingTrigger", seat: state.pendingTriggers.seat });
    }
  }

  if (state.pendingAttack) {
    const attacker = state.instances[state.pendingAttack.attackerIid];
    if (!attacker) {
      errors.push(`pending attack references missing attacker ${state.pendingAttack.attackerIid}.`);
    } else if (!state.players[attacker.controller].frontLine.includes(state.pendingAttack.attackerIid)) {
      errors.push(`pending attacker ${state.pendingAttack.attackerIid} is not on its controller's front line.`);
    }

    if (state.pendingAttack.targetIid) {
      const target = state.instances[state.pendingAttack.targetIid];
      if (!target) {
        errors.push(`pending attack references missing target ${state.pendingAttack.targetIid}.`);
      } else if (!state.players[target.controller].frontLine.includes(state.pendingAttack.targetIid)) {
        errors.push(`pending target ${state.pendingAttack.targetIid} is not on its controller's front line.`);
      }
    }
  }

  for (const [iid, inst] of Object.entries(state.instances)) {
    if (!state.defs[inst.defId]) {
      errors.push(`${iid} references missing def ${inst.defId}.`);
    }
    for (const underIid of inst.raidUnder) {
      if (!state.instances[underIid]) {
        errors.push(`${iid}.raidUnder references missing instance ${underIid}.`);
        continue;
      }
      addLocation(locations, underIid, { kind: "under", topIid: iid });
    }
  }

  for (const iid of Object.keys(state.instances)) {
    const found = locations.get(iid) ?? [];
    if (found.length === 0) {
      errors.push(`${iid} is not in any zone, pending trigger, or stack.`);
    } else if (found.length > 1) {
      errors.push(`${iid} appears in ${found.map(describeLocation).join(", ")}.`);
    }
  }

  return errors;
}

export function formatSelfPlayFailure(failure: SelfPlayFailure): string {
  const lines = [
    "selfplay failed",
    `seed=${failure.seed}${failure.productCode ? ` product=${failure.productCode}` : ""} step=${failure.step}`,
    `reason=${failure.reason}`,
  ];
  if (failure.lastIntent) {
    lines.push(`last=${JSON.stringify(failure.lastIntent)}`);
  }
  lines.push("", "transcript:");
  for (const entry of failure.transcript) {
    lines.push(`${entry.step} ${entry.seat} ${JSON.stringify(entry.intent)}`);
  }
  return lines.join("\n");
}

function failure(args: {
  seed: number;
  productCode: string;
  step: number;
  reason: string;
  lastIntent?: Intent;
  transcript: SelfPlayStep[];
}): SelfPlayResult {
  return { ok: false, ...args };
}

function choosePool(pools: ProductPool[], productCode: string | undefined, seed: number): { pool: ProductPool; seed: number } | null {
  if (productCode) {
    const pool = pools.find((p) => p.productCode === productCode);
    return pool ? { pool, seed } : null;
  }
  const usable = pools.filter((pool) => makeSelfPlayDeck(pool, seed) != null);
  if (usable.length === 0) return null;
  const chosen = choose(usable, seed);
  return { pool: chosen.item, seed: chosen.seed };
}

export function runSelfPlay(options: SelfPlayOptions): SelfPlayResult {
  const seed = options.seed ?? 1;
  const maxSteps = options.maxSteps ?? 200;
  let rng = seed | 0;
  const pools = buildProductPools(options.setsDir);
  const selected = choosePool(pools, options.productCode, rng);
  if (!selected) {
    return failure({
      seed,
      productCode: options.productCode ?? "unknown",
      step: 0,
      reason: options.productCode
        ? `No product pool found for ${options.productCode}.`
        : "No product pool can generate a legal self-play deck.",
      transcript: [],
    });
  }
  rng = selected.seed;
  const pool = selected.pool;
  const deck = makeSelfPlayDeck(pool, rng);
  if (!deck) {
    return failure({
      seed,
      productCode: pool.productCode,
      step: 0,
      reason: `Product ${pool.productCode} cannot generate a legal self-play deck.`,
      transcript: [],
    });
  }

  let state = createGame({
    seed,
    defs: pool.defs,
    decks: {
      p1: { cards: deck, apCardId: pool.apCardId },
      p2: { cards: deck, apCardId: pool.apCardId },
    },
  });

  const transcript: SelfPlayStep[] = [];
  for (const seat of ["p1", "p2"] as const) {
    const intent: Intent = { type: "mulligan", seat, keep: true };
    const result = applyIntent(state, intent);
    if (!result.ok) {
      return failure({ seed, productCode: pool.productCode, step: transcript.length + 1, reason: result.error, lastIntent: intent, transcript });
    }
    transcript.push({ step: transcript.length + 1, seat, intent });
    state = result.state;
  }
  state = beginFirstTurn(state);

  let invariantErrors = validateSelfPlayInvariants(state);
  if (invariantErrors.length > 0) {
    return failure({ seed, productCode: pool.productCode, step: transcript.length, reason: invariantErrors.join("\n"), transcript });
  }

  for (let step = transcript.length + 1; step <= maxSteps; step++) {
    if (state.winner) {
      return { ok: true, seed, productCode: pool.productCode, steps: step - 1, transcript };
    }

    const actor = requiredActor(state);
    const generated = candidatesFor(state);
    const ordered = orderCandidates(generated, rng, options.biasEffects ?? false);
    rng = ordered.seed;

    let accepted: { intent: Intent; state: GameState } | null = null;
    let lastRejected = "No candidate intents.";
    for (const intent of ordered.items) {
      const result = applyIntent(state, intent);
      if (result.ok) {
        accepted = { intent, state: result.state };
        break;
      }
      lastRejected = result.error;
    }

    if (!accepted) {
      return failure({
        seed,
        productCode: pool.productCode,
        step,
        reason: `No accepted intent in ${state.phase} for ${actor}: ${lastRejected}`,
        transcript,
      });
    }

    transcript.push({ step, seat: actor, intent: accepted.intent });
    state = accepted.state;

    invariantErrors = validateSelfPlayInvariants(state);
    if (invariantErrors.length > 0) {
      return failure({
        seed,
        productCode: pool.productCode,
        step,
        reason: invariantErrors.join("\n"),
        lastIntent: accepted.intent,
        transcript,
      });
    }
  }

  return { ok: true, seed, productCode: pool.productCode, steps: maxSteps, transcript };
}
