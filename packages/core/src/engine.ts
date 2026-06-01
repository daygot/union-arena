// Authoritative deterministic reducer: validate + apply a single Intent.
// Clients send Intents; only this engine mutates state. Same state+intent => same result.
import type {
  ApplyResult,
  GameEvent,
  GameState,
  Intent,
  Phase,
  Seat,
} from "./types.js";
import { apForTurn, playerTurnNumber } from "./rules.js";
import {
  activeApCount,
  effectiveBp,
  err,
  getDef,
  getInst,
  hasRequiredEnergy,
  ok,
  opponentOf,
  payAp,
  removeFrom,
  withInstance,
  withPlayer,
} from "./helpers.js";
import { resolveTriggerEffect } from "./triggers.js";
import { runEffects, runEffect, effectsFor } from "./effects.js";
import { performRaid } from "./raid.js";

const PHASE_ORDER: Phase[] = ["start", "movement", "main", "attack", "end"];

function log(state: GameState, ...events: GameEvent[]): GameState {
  return { ...state, log: [...state.log, ...events] };
}

/** Entry point. */
export function applyIntent(state: GameState, intent: Intent): ApplyResult {
  if (state.winner) return err("Game is over.");

  switch (intent.type) {
    case "mulligan":
      return handleMulligan(state, intent.seat, intent.keep);
    case "extraDraw":
      return handleExtraDraw(state, intent.seat);
    case "move":
      return handleMove(state, intent.seat, intent.iid, intent.to);
    case "playCard":
      return handlePlayCard(state, intent.seat, intent.iid, intent.to, intent.targetIid);
    case "raid":
      return handleRaid(state, intent.seat, intent.iid, intent.targetIid);
    case "useEvent":
      return handleUseEvent(state, intent.seat, intent.iid);
    case "declareAttack":
      return handleDeclareAttack(state, intent.seat, intent.attackerIid, intent.targetIid);
    case "declareBlock":
      return handleDeclareBlock(state, intent.seat, intent.blockerIid);
    case "resolveTrigger":
      return handleResolveTrigger(state, intent);
    case "advancePhase":
      return handleAdvancePhase(state, intent.seat);
    case "endTurn":
      return handleEndTurn(state, intent.seat);
    case "activateAbility":
      return handleActivateAbility(state, intent.seat, intent.iid, intent.effectId);
    default:
      return err(`Unknown intent.`);
  }
}

// ---- Draw / deck-out ----

/** Draw n cards; returns new state. Caller must check deck-out separately for start-phase loss. */
function draw(state: GameState, seat: Seat, n: number): GameState {
  let s = state;
  let drawn = 0;
  for (let i = 0; i < n; i++) {
    const p = s.players[seat];
    if (p.deck.length === 0) break;
    const [top, ...rest] = p.deck;
    s = withPlayer(s, seat, (pl) => ({ ...pl, deck: rest, hand: [...pl.hand, top!] }));
    drawn++;
  }
  return drawn > 0 ? log(s, { kind: "draw", seat, count: drawn }) : s;
}

// ---- Mulligan ----

function handleMulligan(state: GameState, seat: Seat, keep: boolean): ApplyResult {
  if (state.turn !== 1 || state.phase !== "start")
    return err("Mulligan only allowed before the first turn begins.");
  const p = state.players[seat];
  if (p.hasMulliganed) return err("Already decided mulligan.");
  if (keep) {
    return ok(withPlayer(state, seat, (pl) => ({ ...pl, hasMulliganed: true })));
  }
  // Put hand on bottom, reshuffle is simplified: put hand bottom then draw 7 new.
  let s = withPlayer(state, seat, (pl) => ({
    ...pl,
    deck: [...pl.deck, ...pl.hand],
    hand: [],
    hasMulliganed: true,
  }));
  s = draw(s, seat, 7);
  return ok(s);
}

// ---- Start phase machinery (run when entering start phase) ----

/**
 * Run the start phase for the active seat: refresh resting cards, top up AP, draw.
 * Returns updated state, or sets winner on deck-out.
 */
function runStartPhase(state: GameState): GameState {
  const seat = state.activeSeat;
  let s = state;

  // 2. Switch all resting cards (chars, sites, AP) to active.
  for (const iid of Object.keys(s.instances)) {
    const inst = s.instances[iid]!;
    if (inst.controller === seat && inst.orientation === "resting") {
      s = withInstance(s, iid, (i) => ({ ...i, orientation: "active" }));
    }
  }
  // reset per-turn flags
  s = withPlayer(s, seat, (p) => ({ ...p, extraDrawUsedThisTurn: false }));

  // 3. Top up AP to the table count (set active). We model AP cards as already present (3),
  //    activating up to apForTurn of them; the rest stay unavailable this early-turn.
  const target = apForTurn(seat, playerTurnNumber(seat, s.turn));
  let activated = 0;
  s = {
    ...s,
    instances: { ...s.instances },
  };
  for (const iid of s.players[seat].ap) {
    const want = activated < target ? "active" : "resting";
    s = withInstance(s, iid, (i) => ({ ...i, orientation: want }));
    if (activated < target) activated++;
  }

  // 4. Draw a card (Player One skips on turn 1).
  const skipDraw = seat === "p1" && s.turn === 1;
  if (!skipDraw) {
    if (s.players[seat].deck.length === 0) {
      // Deck-out: this player loses.
      const winner = opponentOf(seat);
      return log({ ...s, winner, reason: "deckout" }, { kind: "win", seat: winner, reason: "deckout" });
    }
    s = draw(s, seat, 1);
  }
  return s;
}

function handleExtraDraw(state: GameState, seat: Seat): ApplyResult {
  if (seat !== state.activeSeat) return err("Not your turn.");
  if (state.phase !== "start") return err("Extra draw happens between start and movement.");
  const p = state.players[seat];
  if (p.extraDrawUsedThisTurn) return err("Extra draw already used this turn.");
  if (activeApCount(state, seat) < 1) return err("Not enough AP for extra draw.");
  if (p.deck.length === 0) return err("No cards left to draw.");
  let s = payAp(state, seat, 1);
  s = withPlayer(s, seat, (pl) => ({ ...pl, extraDrawUsedThisTurn: true }));
  s = draw(s, seat, 1);
  return ok(s);
}

// ---- Movement phase ----

function handleMove(
  state: GameState,
  seat: Seat,
  iid: string,
  to: "frontLine" | "energyLine",
): ApplyResult {
  if (seat !== state.activeSeat) return err("Not your turn.");
  if (state.phase !== "movement") return err("Can only move during movement phase.");
  const p = state.players[seat];
  const inst = getInst(state, iid);
  if (inst.controller !== seat) return err("Not your card.");
  const def = getDef(state, iid);
  if (def.type === "site") return err("Sites cannot move.");

  const onFront = p.frontLine.includes(iid);
  const onEnergy = p.energyLine.includes(iid);
  if (!onFront && !onEnergy) return err("Card is not on your field.");

  if (to === "frontLine") {
    if (onFront) return err("Already on front line.");
    if (p.frontLine.length >= 4) return err("Front line is full.");
    let s = withPlayer(state, seat, (pl) => ({
      ...pl,
      energyLine: removeFrom(pl.energyLine, iid),
      frontLine: [...pl.frontLine, iid],
    }));
    return ok(log(s, { kind: "move", seat, iid, from: "energyLine", to: "frontLine" }));
  } else {
    // to energy line: requires Step.
    if (onEnergy) return err("Already on energy line.");
    if (!def.keywords.includes("step")) return err("Only characters with Step can move to energy line.");
    if (p.energyLine.length >= 4) return err("Energy line is full.");
    let s = withPlayer(state, seat, (pl) => ({
      ...pl,
      frontLine: removeFrom(pl.frontLine, iid),
      energyLine: [...pl.energyLine, iid],
    }));
    return ok(log(s, { kind: "move", seat, iid, from: "frontLine", to: "energyLine" }));
  }
}

// ---- Main phase: play cards ----

function handlePlayCard(
  state: GameState,
  seat: Seat,
  iid: string,
  to?: "frontLine" | "energyLine",
  targetIid?: string,
): ApplyResult {
  if (seat !== state.activeSeat) return err("Not your turn.");
  if (state.phase !== "main") return err("Can only play cards during main phase.");
  const p = state.players[seat];
  if (!p.hand.includes(iid)) return err("Card not in hand.");
  const def = getDef(state, iid);

  if (def.type === "event") return err("Use useEvent for event cards.");

  let dest: "frontLine" | "energyLine";
  if (def.type === "site") {
    if (to === "frontLine") return err("Sites can only go to the energy line.");
    dest = "energyLine";
  } else {
    dest = to ?? "energyLine";
  }

  if (!hasRequiredEnergy(state, seat, def)) return err("Not enough energy.");
  if (activeApCount(state, seat) < def.apCost) return err("Not enough AP.");
  if (p[dest].length >= 4) return err(`${dest} is full.`);

  let s = payAp(state, seat, def.apCost);
  // Enters resting.
  s = withInstance(s, iid, (i) => ({ ...i, orientation: "resting" }));
  s = withPlayer(s, seat, (pl) => ({
    ...pl,
    hand: removeFrom(pl.hand, iid),
    [dest]: [...pl[dest], iid],
  }));
  s = log(s, { kind: "play", seat, iid, to: dest });
  // Fire any on-play abilities now that the card is on the field.
  const fx = runEffects(s, iid, "onPlay", { ...(targetIid !== undefined ? { targetIid } : {}) });
  if (!fx.ok) return fx;
  return ok(fx.state);
}

function handleRaid(
  state: GameState,
  seat: Seat,
  iid: string,
  targetIid: string,
): ApplyResult {
  if (seat !== state.activeSeat) return err("Not your turn.");
  if (state.phase !== "main") return err("Can only Raid during main phase.");
  const p = state.players[seat];
  if (!p.hand.includes(iid)) return err("Raid card not in hand.");
  const def = getDef(state, iid);
  if (activeApCount(state, seat) < def.apCost) return err("Not enough AP.");

  let s = payAp(state, seat, def.apCost);
  s = withPlayer(s, seat, (pl) => ({ ...pl, hand: removeFrom(pl.hand, iid) }));
  const raid = performRaid(s, { seat, raidIid: iid, targetIid });
  if (!raid.ok) return raid;
  const to = raid.state.players[seat].frontLine.includes(iid) ? "frontLine" : "energyLine";
  return ok(log(raid.state, { kind: "play", seat, iid, to }, { kind: "info", message: `${def.name} raided.` }));
}

function handleActivateAbility(
  state: GameState,
  seat: Seat,
  iid: string,
  effectId: string,
): ApplyResult {
  if (seat !== state.activeSeat) return err("Not your turn.");
  const inst = getInst(state, iid);
  if (inst.controller !== seat) return err("You don't control that card.");
  const p = state.players[seat];
  if (!p.frontLine.includes(iid) && !p.energyLine.includes(iid))
    return err("Card must be on your field to activate.");
  const def = getDef(state, iid);
  if (!def.effectIds.includes(effectId))
    return err("That card has no such ability.");
  // Only `activate`-typed effects can be triggered this way.
  const available = effectsFor(state, iid, "activate");
  if (!available.some((e) => e.id === effectId))
    return err("That ability is not manually activatable.");
  // (Activation AP cost not modeled yet; scraped data has no separate cost.)
  const fx = runEffect(state, iid, effectId, {});
  if (!fx.ok) return fx;
  return ok(log(fx.state, { kind: "info", message: `${def.name}: ${effectId} activated.` }));
}

function handleUseEvent(state: GameState, seat: Seat, iid: string): ApplyResult {
  if (seat !== state.activeSeat) return err("Not your turn.");
  if (state.phase !== "main") return err("Can only use events during main phase.");
  const p = state.players[seat];
  if (!p.hand.includes(iid)) return err("Card not in hand.");
  const def = getDef(state, iid);
  if (def.type !== "event") return err("Not an event card.");
  if (!hasRequiredEnergy(state, seat, def)) return err("Not enough energy.");
  if (activeApCount(state, seat) < def.apCost) return err("Not enough AP.");

  let s = payAp(state, seat, def.apCost);
  s = withPlayer(s, seat, (pl) => ({
    ...pl,
    hand: removeFrom(pl.hand, iid),
    sideline: [...pl.sideline, iid],
  }));
  const fx = runEffects(s, iid, "onUse", {});
  if (!fx.ok) return fx;
  return ok(log(fx.state, { kind: "info", message: `${def.name} used.` }, { kind: "play", seat, iid, to: "sideline" }));
}

// ---- Attack phase ----

function handleDeclareAttack(
  state: GameState,
  seat: Seat,
  attackerIid: string,
  targetIid?: string,
): ApplyResult {
  if (seat !== state.activeSeat) return err("Not your turn.");
  if (state.phase !== "attack") return err("Can only attack during attack phase.");
  if (state.pendingAttack) return err("Resolve the current attack first.");
  const p = state.players[seat];
  if (!p.frontLine.includes(attackerIid)) return err("Attacker must be on your front line.");
  const inst = getInst(state, attackerIid);
  if (inst.orientation !== "active") return err("Attacker must be active.");
  const def = getDef(state, attackerIid);

  // Snipe targeting validation.
  if (targetIid !== undefined) {
    if (!def.keywords.includes("snipe")) return err("Only Snipe can target a character.");
    const oppFront = state.players[opponentOf(seat)].frontLine;
    if (!oppFront.includes(targetIid)) return err("Snipe target must be on opponent front line.");
  }

  // Switch attacker to resting.
  let s = withInstance(state, attackerIid, (i) => ({ ...i, orientation: "resting" }));
  s = { ...s, pendingAttack: { attackerIid, ...(targetIid !== undefined ? { targetIid } : {}) } };
  s = log(s, { kind: "attack", seat, attackerIid, ...(targetIid !== undefined ? { targetIid } : {}) });
  // Fire any on-attack abilities.
  const fx = runEffects(s, attackerIid, "onAttack", {});
  if (!fx.ok) return fx;
  return ok(fx.state);
}

function handleDeclareBlock(state: GameState, seat: Seat, blockerIid?: string): ApplyResult {
  const pa = state.pendingAttack;
  if (!pa) return err("No attack to block.");
  const defender = opponentOf(state.activeSeat);
  if (seat !== defender) return err("Only the defending player blocks.");

  // Snipe: target can't block; resolve as a character battle vs the sniped target.
  if (pa.targetIid !== undefined) {
    if (blockerIid) return err("Sniped attacks cannot be blocked.");
    return resolveBattle(state, pa.attackerIid, pa.targetIid);
  }

  if (blockerIid) {
    const dp = state.players[defender];
    if (!dp.frontLine.includes(blockerIid)) return err("Blocker must be on your front line.");
    const binst = getInst(state, blockerIid);
    if (binst.orientation !== "active") return err("Blocker must be active.");
    let s = withInstance(state, blockerIid, (i) => ({ ...i, orientation: "resting" }));
    s = log(s, { kind: "block", seat: defender, blockerIid });
    // Fire on-block abilities (e.g. conditional BP gain) while pendingAttack is set.
    const fx = runEffects(s, blockerIid, "onBlock", {});
    if (!fx.ok) return fx;
    return resolveBattle(fx.state, pa.attackerIid, blockerIid);
  }

  // No block -> direct damage to defender (player).
  return resolveDirectDamage(state, pa.attackerIid);
}

/** Battle between attacker and a defending character. */
function resolveBattle(state: GameState, attackerIid: string, defenderIid: string): ApplyResult {
  const aBp = effectiveBp(state, attackerIid);
  const dBp = effectiveBp(state, defenderIid);
  const aDef = getDef(state, attackerIid);
  let s: GameState = { ...state };
  s = { ...s, pendingAttack: undefined };

  let winnerIid: string | null;
  if (aBp >= dBp) {
    winnerIid = attackerIid;
    s = sideline(s, defenderIid);
    const fx = runEffects(s, defenderIid, "onSideline", {});
    if (!fx.ok) return fx;
    s = fx.state;
  } else {
    winnerIid = defenderIid;
    // Attacker is not sidelined when it loses.
  }
  s = log(s, { kind: "battle", attackerIid, defenderIid, winnerIid });

  // Impact: even if blocked, damage still goes through to the player.
  if (aDef.keywords.includes("impact")) {
    return resolveDirectDamage(s, attackerIid);
  }
  return ok(s);
}

/** Move a character from the field to its owner's sideline. */
function sideline(state: GameState, iid: string): GameState {
  const inst = getInst(state, iid);
  const owner = inst.owner;
  let s = withPlayer(state, inst.controller, (p) => ({
    ...p,
    frontLine: removeFrom(p.frontLine, iid),
    energyLine: removeFrom(p.energyLine, iid),
  }));
  s = withPlayer(s, owner, (p) => ({ ...p, sideline: [...p.sideline, iid] }));
  s = withInstance(s, iid, (i) => ({ ...i, orientation: "active" }));
  return log(s, { kind: "sideline", iid });
}

/** Deal direct damage to the defending player: reveal life cards, queue triggers. */
function resolveDirectDamage(state: GameState, attackerIid: string): ApplyResult {
  const attackerSeat = getInst(state, attackerIid).controller;
  const defender = opponentOf(attackerSeat);
  const def = getDef(state, attackerIid);
  const amount = Math.max(1, def.impactN ?? 1);

  let s: GameState = { ...state, pendingAttack: undefined };
  s = log(s, { kind: "damage", seat: defender, amount });

  const dp = s.players[defender];
  const revealCount = Math.min(amount, dp.life.length);
  const revealed = dp.life.slice(0, revealCount);
  s = withPlayer(s, defender, (p) => ({ ...p, life: p.life.slice(revealCount) }));
  for (const iid of revealed) {
    s = withInstance(s, iid, (i) => ({ ...i, faceUp: true }));
  }

  // Win check: no life left.
  if (s.players[defender].life.length === 0 && revealCount >= dp.life.length) {
    // If they had 0 to begin with OR just lost the last ones, attacker wins after triggers.
  }

  if (revealed.length > 0) {
    s = { ...s, pendingTriggers: { seat: defender, iids: revealed } };
    return ok(s);
  }
  // No life cards to reveal at all -> defender already had 0 -> attacker wins.
  return ok(checkLifeWin(s, defender, attackerSeat));
}

function handleResolveTrigger(
  state: GameState,
  intent: Extract<Intent, { type: "resolveTrigger" }>,
): ApplyResult {
  const { seat, iid, activate, targetIid, playIid } = intent;
  const pt = state.pendingTriggers;
  if (!pt) return err("No triggers to resolve.");
  if (seat !== pt.seat) return err("Only the damaged player resolves their triggers.");
  if (!pt.iids.includes(iid)) return err("That card is not awaiting trigger resolution.");

  // The revealed card's CardDef carries its (fixed) trigger type.
  const def = getDef(state, iid);
  const triggerType = def.hasTrigger && def.triggerType ? def.triggerType : "none";

  // Resolve via the hard-coded trigger registry. This disposes the source card
  // (to sideline, or to hand for `get`).
  const res = resolveTriggerEffect(state, triggerType, {
    seat,
    iid,
    activate,
    ...(targetIid ? { targetIid } : {}),
    ...(playIid ? { playIid } : {}),
  });
  if (!res.ok) return res;
  let s = log(res.state, { kind: "trigger", seat, iid, activated: activate });

  const remaining = pt.iids.filter((x) => x !== iid);
  if (remaining.length > 0) {
    s = { ...s, pendingTriggers: { seat, iids: remaining } };
    return ok(s);
  }
  s = { ...s, pendingTriggers: undefined };
  // After all triggers resolved, check life-out.
  s = checkLifeWin(s, seat, opponentOf(seat));
  return ok(s);
}

/** If `damaged` has no life left, `attacker` wins. */
function checkLifeWin(state: GameState, damaged: Seat, attacker: Seat): GameState {
  if (state.winner) return state;
  if (state.players[damaged].life.length === 0) {
    return log({ ...state, winner: attacker, reason: "life" }, { kind: "win", seat: attacker, reason: "life" });
  }
  return state;
}

// ---- Phase advancement ----

function handleAdvancePhase(state: GameState, seat: Seat): ApplyResult {
  if (seat !== state.activeSeat) return err("Not your turn.");
  if (state.pendingAttack) return err("Resolve the current attack before advancing.");
  if (state.pendingTriggers) return err("Resolve pending triggers before advancing.");

  const idx = PHASE_ORDER.indexOf(state.phase);
  if (idx < PHASE_ORDER.length - 1) {
    const nextPhase = PHASE_ORDER[idx + 1]!;
    let s: GameState = { ...state, phase: nextPhase };
    s = log(s, { kind: "phase", phase: nextPhase, seat, turn: s.turn });
    return ok(s);
  }

  // End phase -> pass turn to opponent and run their start phase.
  let s = runEndPhase(state);
  const next = opponentOf(seat);
  s = { ...s, activeSeat: next, turn: s.turn + 1, phase: "start" };
  s = log(s, { kind: "phase", phase: "start", seat: next, turn: s.turn });
  s = runStartPhase(s);
  return ok(s);
}

function handleEndTurn(state: GameState, seat: Seat): ApplyResult {
  if (seat !== state.activeSeat) return err("Not your turn.");
  if (state.pendingAttack) return err("Resolve the current attack before ending turn.");
  if (state.pendingTriggers) return err("Resolve pending triggers before ending turn.");

  let s: GameState = state.phase === "end" ? state : { ...state, phase: "end" };
  if (state.phase !== "end") {
    s = log(s, { kind: "phase", phase: "end", seat, turn: s.turn });
  }
  s = runEndPhase(s);
  const next = opponentOf(seat);
  s = { ...s, activeSeat: next, turn: s.turn + 1, phase: "start" };
  s = log(s, { kind: "phase", phase: "start", seat: next, turn: s.turn });
  s = runStartPhase(s);
  return ok(s);
}

/** End phase: refresh resting chars/sites to active, discard hand to 8. */
function runEndPhase(state: GameState): GameState {
  const seat = state.activeSeat;
  let s = state;
  // Switch resting characters/sites to active (AP cards stay resting).
  for (const iid of [...s.players[seat].frontLine, ...s.players[seat].energyLine]) {
    if (getInst(s, iid).orientation === "resting") {
      s = withInstance(s, iid, (i) => ({ ...i, orientation: "active" }));
    }
  }
  // Clear "until end of turn" BP modifiers on all characters (both players).
  for (const iid of Object.keys(s.instances)) {
    if (s.instances[iid]!.bpModifier) {
      s = withInstance(s, iid, (i) => ({ ...i, bpModifier: 0 }));
    }
  }
  // Hand size limit 8: extras to removal (oldest kept arbitrarily = keep first 8).
  const hand = s.players[seat].hand;
  if (hand.length > 8) {
    const keep = hand.slice(0, 8);
    const discard = hand.slice(8);
    s = withPlayer(s, seat, (p) => ({ ...p, hand: keep, removal: [...p.removal, ...discard] }));
  }
  return s;
}

/** Convenience: kick off the first turn's start phase after createGame + mulligans. */
export function beginFirstTurn(state: GameState): GameState {
  let s = log(state, { kind: "phase", phase: "start", seat: state.activeSeat, turn: state.turn });
  return runStartPhase(s);
}
