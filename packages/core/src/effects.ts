// Card ability system.
//
// Cards reference named effects via `CardDef.effectIds`. Each effect id maps to an
// EffectDef in the registry, with a `when` trigger (when it fires) and a pure `run`
// resolver. Effect ids are inferred from official card text by the card-data mapper
// (pattern matching), so real cards get real behavior without hand-tagging each one.
//
// This is intentionally small and data-driven: add new ids + patterns as sets land.
import type { ApplyResult, GameState, Seat } from "./types.js";
import { effectiveBp, err, getDef, getInst, ok, opponentOf, removeFrom, withInstance, withPlayer } from "./helpers.js";

/** When an effect fires. */
export type EffectTrigger =
  | "static" // passive/static modifier resolved outside the effect runner
  | "onPlay" // when the card is played from hand to the field
  | "onUse" // when an event card is used
  | "onSideline" // when a card is moved to sideline
  | "onAttack" // when the card declares an attack
  | "onBlock" // when the card blocks
  | "activate"; // manual, player-initiated (activateAbility intent)

/** Context handed to an effect resolver. */
export interface EffectContext {
  /** The instance the effect belongs to. */
  iid: string;
  /** The controller of that instance. */
  seat: Seat;
  /** Optional target chosen by the player (validated by the resolver). */
  targetIid?: string;
}

export interface EffectDef {
  id: string;
  when: EffectTrigger;
  /** Human description for UI / fallbacks. */
  text: string;
  /** Pure resolver: returns a new state or an error. */
  run: (state: GameState, ctx: EffectContext) => ApplyResult;
}

function isTemporaryEnergyGenerationText(text: string): boolean {
  const normalized = text
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
  return /this character gains energy generation and "at the end of the main phase, sideline this character" until the end of the turn\.?/i.test(
    normalized,
  );
}

export function resolvedEffectIds(def: { effectIds: string[]; text: string }): string[] {
  const ids = [...def.effectIds];
  if (
    isTemporaryEnergyGenerationText(def.text) &&
    !ids.includes("energy_generation_eot_and_sideline_on_activate")
  ) {
    ids.push("energy_generation_eot_and_sideline_on_activate");
  }
  return ids;
}

const BUFF_EOT = 3000;

/** Grant a "until end of turn" BP modifier to one instance. */
function buff(state: GameState, iid: string, amount: number): GameState {
  return withInstance(state, iid, (i) => ({ ...i, bpModifier: (i.bpModifier ?? 0) + amount }));
}

function grantEnergyGenerationEot(state: GameState, iid: string): GameState {
  const def = getDef(state, iid);
  return withInstance(state, iid, (i) => ({
    ...i,
    energyModifier: [...(i.energyModifier ?? []), { color: def.color, amount: 1 }],
  }));
}

function markSidelineAtEndOfMain(state: GameState, iid: string): GameState {
  return withInstance(state, iid, (i) => ({ ...i, sidelineAtEndOfMain: true }));
}

/** A character is "on your field" if it's in your front or energy line. */
function onField(state: GameState, seat: Seat, iid: string): boolean {
  const p = state.players[seat];
  return p.frontLine.includes(iid) || p.energyLine.includes(iid);
}

function draw(state: GameState, seat: Seat, count: number): GameState {
  let s = state;
  for (let i = 0; i < count; i++) {
    const deck = s.players[seat].deck;
    if (deck.length === 0) return s;
    const [top, ...rest] = deck;
    s = withPlayer(s, seat, (p) => ({ ...p, deck: rest, hand: [...p.hand, top!] }));
  }
  return s;
}

function drawOne(state: GameState, seat: Seat): GameState {
  return draw(state, seat, 1);
}

function sidelineOneFromHand(state: GameState, seat: Seat): GameState {
  const hand = state.players[seat].hand;
  if (hand.length === 0) return state;
  const iid = hand[hand.length - 1]!;
  return withPlayer(state, seat, (p) => ({
    ...p,
    hand: removeFrom(p.hand, iid),
    sideline: [...p.sideline, iid],
  }));
}

function refreshAp(state: GameState, seat: Seat, max: number): GameState {
  let s = state;
  let refreshed = 0;
  for (const iid of s.players[seat].ap) {
    if (refreshed >= max) break;
    if (getInst(s, iid).orientation === "resting") {
      s = withInstance(s, iid, (i) => ({ ...i, orientation: "active" }));
      refreshed++;
    }
  }
  return s;
}

function ownField(state: GameState, seat: Seat): string[] {
  const p = state.players[seat];
  return [...p.frontLine, ...p.energyLine];
}

function opponentFront(state: GameState, seat: Seat): string[] {
  return state.players[opponentOf(seat)].frontLine;
}

function firstOtherOwnCharacter(state: GameState, seat: Seat, iid: string): string | undefined {
  return ownField(state, seat).find((candidate) => candidate !== iid && getDef(state, candidate).type === "character");
}

function removeFromField(state: GameState, seat: Seat, iid: string): GameState {
  return withPlayer(state, seat, (p) => ({
    ...p,
    frontLine: removeFrom(p.frontLine, iid),
    energyLine: removeFrom(p.energyLine, iid),
  }));
}

function sidelineFromField(state: GameState, iid: string): GameState {
  const inst = getInst(state, iid);
  let s = removeFromField(state, inst.controller, iid);
  s = withPlayer(s, inst.owner, (p) => ({ ...p, sideline: [...p.sideline, iid] }));
  return withInstance(s, iid, (i) => ({ ...i, orientation: "active" }));
}

function returnFromFieldToHand(state: GameState, iid: string): GameState {
  const inst = getInst(state, iid);
  let s = removeFromField(state, inst.controller, iid);
  s = withPlayer(s, inst.owner, (p) => ({ ...p, hand: [...p.hand, iid] }));
  return withInstance(s, iid, (i) => ({ ...i, orientation: "active" }));
}

function placeOpponentFrontIntoLife(state: GameState, seat: Seat, targetIid?: string): ApplyResult {
  const opponent = opponentOf(seat);
  const target = targetIid ?? opponentFront(state, seat)[0];
  if (!target) return ok(state);
  if (!state.players[opponent].frontLine.includes(target)) return err("Target must be on opponent's front line.");
  let s = removeFromField(state, opponent, target);
  s = withInstance(s, target, (i) => ({ ...i, orientation: "active", faceUp: true }));
  s = withPlayer(s, opponent, (p) => ({ ...p, life: [...p.life, target] }));
  return ok(s);
}

function sidelineOpponentFrontMaxBp(state: GameState, seat: Seat, maxBp: number, targetIid?: string): ApplyResult {
  const target = targetIid ?? opponentFront(state, seat).find((iid) => effectiveBp(state, iid) <= maxBp);
  if (!target) return ok(state);
  if (!opponentFront(state, seat).includes(target)) return err("Target must be on opponent's front line.");
  if (effectiveBp(state, target) > maxBp) return err(`Target must have ${maxBp} or less BP.`);
  return ok(sidelineFromField(state, target));
}

function bounceOpponentFrontMaxBp(state: GameState, seat: Seat, maxBp: number, targetIid?: string): ApplyResult {
  const target = targetIid ?? opponentFront(state, seat).find((iid) => effectiveBp(state, iid) <= maxBp);
  if (!target) return ok(state);
  if (!opponentFront(state, seat).includes(target)) return err("Target must be on opponent's front line.");
  if (effectiveBp(state, target) > maxBp) return err(`Target must have ${maxBp} or less BP.`);
  return ok(returnFromFieldToHand(state, target));
}

function restOpponentFront(state: GameState, seat: Seat, targetIid?: string): ApplyResult {
  const target = targetIid ?? opponentFront(state, seat).find((iid) => getInst(state, iid).orientation === "active");
  if (!target) return ok(state);
  if (!opponentFront(state, seat).includes(target)) return err("Target must be on opponent's front line.");
  return ok(withInstance(state, target, (i) => ({ ...i, orientation: "resting" })));
}

function debuffOpponentFront(state: GameState, seat: Seat, amount: number, targetIid?: string): ApplyResult {
  const target = targetIid ?? opponentFront(state, seat)[0];
  if (!target) return ok(state);
  if (!opponentFront(state, seat).includes(target)) return err("Target must be on opponent's front line.");
  return ok(buff(state, target, -amount));
}

function returnOtherLowEnergyOrSelf(state: GameState, ctx: EffectContext, maxEnergy: number): GameState {
  const target =
    ctx.targetIid ??
    ownField(state, ctx.seat).find((iid) => {
      const def = getDef(state, iid);
      const required = def.requiredEnergy.reduce((sum, energy) => sum + energy.amount, 0);
      return iid !== ctx.iid && def.type === "character" && required <= maxEnergy;
    }) ??
    ctx.iid;
  return returnFromFieldToHand(state, target);
}

function searchTopAddOne(state: GameState, seat: Seat, count: number, thenSidelineCard: boolean): GameState {
  const deck = state.players[seat].deck;
  if (deck.length === 0) return state;
  const seen = deck.slice(0, count);
  const rest = deck.slice(count);
  const [picked, ...bottomed] = seen;
  let s = withPlayer(state, seat, (p) => ({
    ...p,
    deck: [...rest, ...bottomed],
    hand: picked ? [...p.hand, picked] : p.hand,
  }));
  if (thenSidelineCard) s = sidelineOneFromHand(s, seat);
  return s;
}

// ---- Registry ----------------------------------------------------------------

export const EFFECTS: Record<string, EffectDef> = {
  energy_generation_if_active: {
    id: "energy_generation_if_active",
    when: "static",
    text: "If active on the energy line, this card generates one energy of its color.",
    run: (state) => ok(state),
  },

  nullify_impact: {
    id: "nullify_impact",
    when: "static",
    text: "The character battling this character loses Impact for the duration of battle.",
    run: (state) => ok(state),
  },

  double_block: {
    id: "double_block",
    when: "onBlock",
    text: "When this character blocks for the first time this turn, switch it to active.",
    run: (state, ctx) => {
      if (getInst(state, ctx.iid).blockedThisTurn) return ok(state);
      return ok(withInstance(state, ctx.iid, (i) => ({ ...i, orientation: "active" })));
    },
  },

  // "Choose up to one other character on your field. It gains 3000 BP until end of turn."
  // Target optional ("up to one"); no target = fizzle (legal).
  buff_other_3000_eot: {
    id: "buff_other_3000_eot",
    when: "onPlay",
    text: "Choose up to one other character on your field. It gains 3000 BP until end of turn.",
    run: (state, ctx) => {
      const { seat, iid, targetIid } = ctx;
      if (!targetIid) return ok(state); // "up to one" -> may choose none
      if (targetIid === iid) return err("Must target a different character.");
      if (!onField(state, seat, targetIid)) return err("Target must be your own field character.");
      return ok(buff(state, targetIid, BUFF_EOT));
    },
  },

  buff_other_3000_eot_on_sideline: {
    id: "buff_other_3000_eot_on_sideline",
    when: "onSideline",
    text: "When sidelined, choose up to one other character on your field. It gains 3000 BP until end of turn.",
    run: (state, ctx) => EFFECTS.buff_other_3000_eot!.run(state, ctx),
  },

  buff_other_3000_eot_on_play: {
    id: "buff_other_3000_eot_on_play",
    when: "onPlay",
    text: "When played, choose up to one other character on your field. It gains 3000 BP until end of turn.",
    run: (state, ctx) => EFFECTS.buff_other_3000_eot!.run(state, ctx),
  },

  buff_other_1000_eot_on_play: {
    id: "buff_other_1000_eot_on_play",
    when: "onPlay",
    text: "When played, choose up to one other character on your field. It gains 1000 BP until end of turn.",
    run: (state, ctx) => {
      const target = ctx.targetIid ?? firstOtherOwnCharacter(state, ctx.seat, ctx.iid);
      if (!target) return ok(state);
      if (target === ctx.iid) return err("Must target a different character.");
      if (!onField(state, ctx.seat, target)) return err("Target must be your own field character.");
      return ok(buff(state, target, 1000));
    },
  },

  buff_other_1000_eot: {
    id: "buff_other_1000_eot",
    when: "activate",
    text: "Choose one other character on your field. It gains 1000 BP until end of turn.",
    run: (state, ctx) => {
      const target = ctx.targetIid ?? firstOtherOwnCharacter(state, ctx.seat, ctx.iid);
      if (!target) return ok(state);
      if (target === ctx.iid) return err("Must target a different character.");
      if (!onField(state, ctx.seat, target)) return err("Target must be your own field character.");
      return ok(buff(state, target, 1000));
    },
  },

  buff_other_2000_eot: {
    id: "buff_other_2000_eot",
    when: "activate",
    text: "Choose up to one other character on your field. It gains 2000 BP until end of turn.",
    run: (state, ctx) => {
      const target = ctx.targetIid ?? firstOtherOwnCharacter(state, ctx.seat, ctx.iid);
      if (!target) return ok(state);
      if (target === ctx.iid) return err("Must target a different character.");
      if (!onField(state, ctx.seat, target)) return err("Target must be your own field character.");
      return ok(buff(state, target, 2000));
    },
  },

  // "This character gains 3000 BP until end of turn." (self buff on play/activate)
  buff_self_3000_eot: {
    id: "buff_self_3000_eot",
    when: "activate",
    text: "This character gains 3000 BP until end of turn.",
    run: (state, ctx) => ok(buff(state, ctx.iid, BUFF_EOT)),
  },

  buff_self_1000_eot: {
    id: "buff_self_1000_eot",
    when: "activate",
    text: "This character gains 1000 BP until end of turn.",
    run: (state, ctx) => ok(buff(state, ctx.iid, 1000)),
  },

  buff_self_2000_eot: {
    id: "buff_self_2000_eot",
    when: "activate",
    text: "This character gains 2000 BP until end of turn.",
    run: (state, ctx) => ok(buff(state, ctx.iid, 2000)),
  },

  energy_generation_eot_and_sideline_on_activate: {
    id: "energy_generation_eot_and_sideline_on_activate",
    when: "activate",
    text: "This character gains energy generation until end of turn, then sidelines itself at end of main phase.",
    run: (state, ctx) => {
      if (getInst(state, ctx.iid).orientation !== "active") {
        return err("This ability can only be activated while the card is active.");
      }
      let s = withInstance(state, ctx.iid, (i) => ({ ...i, orientation: "resting" }));
      s = markSidelineAtEndOfMain(grantEnergyGenerationEot(s, ctx.iid), ctx.iid);
      return ok(s);
    },
  },

  // "When this character blocks ... if the attacker has 3000 or less base BP, gain 2000 BP."
  // (SMD-1-003 on-block, conditional). Uses the pending attacker's BP.
  block_guard_2000: {
    id: "block_guard_2000",
    when: "onBlock",
    text: "When blocking, if the attacker has 3000 or less BP, this character gains 2000 BP until end of battle.",
    run: (state, ctx) => {
      const pa = state.pendingAttack;
      if (!pa) return ok(state);
      const attackerBp = effectiveBp(state, pa.attackerIid);
      if (attackerBp <= 3000) return ok(buff(state, ctx.iid, 2000));
      return ok(state);
    },
  },

  draw_card_on_sideline: {
    id: "draw_card_on_sideline",
    when: "onSideline",
    text: "When sidelined, draw a card.",
    run: (state, ctx) => ok(drawOne(state, ctx.seat)),
  },

  draw_card_on_play: {
    id: "draw_card_on_play",
    when: "onPlay",
    text: "When played, draw a card.",
    run: (state, ctx) => ok(drawOne(state, ctx.seat)),
  },

  draw_card_on_use: {
    id: "draw_card_on_use",
    when: "onUse",
    text: "Draw a card.",
    run: (state, ctx) => ok(drawOne(state, ctx.seat)),
  },

  draw_two_cards_on_use: {
    id: "draw_two_cards_on_use",
    when: "onUse",
    text: "Draw two cards.",
    run: (state, ctx) => ok(draw(state, ctx.seat, 2)),
  },

  draw_card_then_sideline_card_on_sideline: {
    id: "draw_card_then_sideline_card_on_sideline",
    when: "onSideline",
    text: "When sidelined, draw a card, then place one card from your hand into your sideline.",
    run: (state, ctx) => ok(sidelineOneFromHand(drawOne(state, ctx.seat), ctx.seat)),
  },

  draw_card_then_sideline_card_on_play: {
    id: "draw_card_then_sideline_card_on_play",
    when: "onPlay",
    text: "When played, draw a card, then place one card from your hand into your sideline.",
    run: (state, ctx) => ok(sidelineOneFromHand(drawOne(state, ctx.seat), ctx.seat)),
  },

  draw_card_then_sideline_card_on_attack: {
    id: "draw_card_then_sideline_card_on_attack",
    when: "onAttack",
    text: "When attacking, draw a card, then place one card from your hand into your sideline.",
    run: (state, ctx) => ok(sidelineOneFromHand(drawOne(state, ctx.seat), ctx.seat)),
  },

  draw_card_then_sideline_card_on_use: {
    id: "draw_card_then_sideline_card_on_use",
    when: "onUse",
    text: "Draw a card, then place one card from your hand into your sideline.",
    run: (state, ctx) => ok(sidelineOneFromHand(drawOne(state, ctx.seat), ctx.seat)),
  },

  return_other_1_energy_or_self_to_hand_on_play: {
    id: "return_other_1_energy_or_self_to_hand_on_play",
    when: "onPlay",
    text: "Return one other character on your field with 1 or less required energy to your hand. If you cannot, return this character.",
    run: (state, ctx) => ok(returnOtherLowEnergyOrSelf(state, ctx, 1)),
  },

  rest_opponent_front_on_play: {
    id: "rest_opponent_front_on_play",
    when: "onPlay",
    text: "Choose up to one character on your opponent's front line and switch it to resting.",
    run: (state, ctx) => restOpponentFront(state, ctx.seat, ctx.targetIid),
  },

  rest_opponent_front_on_block: {
    id: "rest_opponent_front_on_block",
    when: "onBlock",
    text: "When blocking, choose up to one character on your opponent's front line and switch it to resting.",
    run: (state, ctx) => restOpponentFront(state, ctx.seat, ctx.targetIid),
  },

  rest_opponent_front_activate: {
    id: "rest_opponent_front_activate",
    when: "activate",
    text: "Choose up to one character on your opponent's front line and switch it to resting.",
    run: (state, ctx) => restOpponentFront(state, ctx.seat, ctx.targetIid),
  },

  debuff_opponent_front_500_eot_on_play: {
    id: "debuff_opponent_front_500_eot_on_play",
    when: "onPlay",
    text: "Choose up to one character on your opponent's front line. It loses 500 BP until end of turn.",
    run: (state, ctx) => debuffOpponentFront(state, ctx.seat, 500, ctx.targetIid),
  },

  debuff_opponent_front_1000_eot_on_play: {
    id: "debuff_opponent_front_1000_eot_on_play",
    when: "onPlay",
    text: "Choose up to one character on your opponent's front line. It loses 1000 BP until end of turn.",
    run: (state, ctx) => debuffOpponentFront(state, ctx.seat, 1000, ctx.targetIid),
  },

  debuff_opponent_front_2000_eot_on_play: {
    id: "debuff_opponent_front_2000_eot_on_play",
    when: "onPlay",
    text: "Choose up to one character on your opponent's front line. It loses 2000 BP until end of turn.",
    run: (state, ctx) => debuffOpponentFront(state, ctx.seat, 2000, ctx.targetIid),
  },

  debuff_opponent_front_3000_eot_on_use: {
    id: "debuff_opponent_front_3000_eot_on_use",
    when: "onUse",
    text: "Choose up to one character on your opponent's front line. It loses 3000 BP until end of turn.",
    run: (state, ctx) => debuffOpponentFront(state, ctx.seat, 3000, ctx.targetIid),
  },

  debuff_opponent_front_1000_eot_activate: {
    id: "debuff_opponent_front_1000_eot_activate",
    when: "activate",
    text: "Choose up to one character on your opponent's front line. It loses 1000 BP until end of turn.",
    run: (state, ctx) => debuffOpponentFront(state, ctx.seat, 1000, ctx.targetIid),
  },

  place_opponent_front_into_life_on_play: {
    id: "place_opponent_front_into_life_on_play",
    when: "onPlay",
    text: "Choose up to one character on your opponent's front line. Place it face up into their life area.",
    run: (state, ctx) => placeOpponentFrontIntoLife(state, ctx.seat, ctx.targetIid),
  },

  sideline_opponent_front_3000_or_less_on_use: {
    id: "sideline_opponent_front_3000_or_less_on_use",
    when: "onUse",
    text: "Choose one character with 3000 or less BP on your opponent's front line and sideline it.",
    run: (state, ctx) => sidelineOpponentFrontMaxBp(state, ctx.seat, 3000, ctx.targetIid),
  },

  sideline_opponent_front_5000_or_less_on_use: {
    id: "sideline_opponent_front_5000_or_less_on_use",
    when: "onUse",
    text: "Choose one character with 5000 or less BP on your opponent's front line and sideline it.",
    run: (state, ctx) => sidelineOpponentFrontMaxBp(state, ctx.seat, 5000, ctx.targetIid),
  },

  bounce_opponent_front_3000_or_less_on_play: {
    id: "bounce_opponent_front_3000_or_less_on_play",
    when: "onPlay",
    text: "Choose one character with 3000 or less BP on your opponent's front line and return it to hand.",
    run: (state, ctx) => bounceOpponentFrontMaxBp(state, ctx.seat, 3000, ctx.targetIid),
  },

  bounce_opponent_front_3500_or_less_on_play: {
    id: "bounce_opponent_front_3500_or_less_on_play",
    when: "onPlay",
    text: "Choose one character with 3500 or less BP on your opponent's front line and return it to hand.",
    run: (state, ctx) => bounceOpponentFrontMaxBp(state, ctx.seat, 3500, ctx.targetIid),
  },

  search_top_3_add_one_then_sideline_card_on_play: {
    id: "search_top_3_add_one_then_sideline_card_on_play",
    when: "onPlay",
    text: "Look at the top three cards of your deck. Add one to your hand, put the rest bottom, then sideline one from hand.",
    run: (state, ctx) => ok(searchTopAddOne(state, ctx.seat, 3, true)),
  },

  search_top_4_add_one_then_sideline_card_on_play: {
    id: "search_top_4_add_one_then_sideline_card_on_play",
    when: "onPlay",
    text: "Look at the top four cards of your deck. Add one to your hand, put the rest bottom, then sideline one from hand.",
    run: (state, ctx) => ok(searchTopAddOne(state, ctx.seat, 4, true)),
  },

  search_top_5_add_one_on_use: {
    id: "search_top_5_add_one_on_use",
    when: "onUse",
    text: "Look at the top five cards of your deck. Add one to your hand and put the rest on the bottom.",
    run: (state, ctx) => ok(searchTopAddOne(state, ctx.seat, 5, false)),
  },

  search_top_5_add_one_on_play: {
    id: "search_top_5_add_one_on_play",
    when: "onPlay",
    text: "When played, look at the top five cards of your deck. Add one to your hand and put the rest on the bottom.",
    run: (state, ctx) => ok(searchTopAddOne(state, ctx.seat, 5, false)),
  },

  search_top_7_add_one_on_play: {
    id: "search_top_7_add_one_on_play",
    when: "onPlay",
    text: "Look at the top seven cards of your deck. Add one to your hand and put the rest on the bottom.",
    run: (state, ctx) => ok(searchTopAddOne(state, ctx.seat, 7, false)),
  },

  search_top_7_add_one_on_sideline: {
    id: "search_top_7_add_one_on_sideline",
    when: "onSideline",
    text: "When sidelined, look at the top seven cards of your deck. Add one to your hand and put the rest on the bottom.",
    run: (state, ctx) => ok(searchTopAddOne(state, ctx.seat, 7, false)),
  },

  refresh_up_to_2_ap_on_use: {
    id: "refresh_up_to_2_ap_on_use",
    when: "onUse",
    text: "Choose up to two of your AP cards and switch them to active.",
    run: (state, ctx) => ok(refreshAp(state, ctx.seat, 2)),
  },
};

/** Look up the effect defs for a card instance that match a given trigger. */
export function effectsFor(state: GameState, iid: string, when: EffectTrigger): EffectDef[] {
  const def = getDef(state, iid);
  return resolvedEffectIds(def)
    .map((id) => EFFECTS[id])
    .filter((e): e is EffectDef => !!e && e.when === when);
}

/**
 * Run every effect on `iid` that matches `when`, threading state through each.
 * Effects that error are surfaced (the whole intent fails) so the player can retry
 * with a legal target; effects that "fizzle" simply return state unchanged.
 */
export function runEffects(
  state: GameState,
  iid: string,
  when: EffectTrigger,
  ctx: Omit<EffectContext, "iid" | "seat">,
): ApplyResult {
  const inst = getInst(state, iid);
  let s = state;
  for (const eff of effectsFor(s, iid, when)) {
    const res = eff.run(s, { iid, seat: inst.controller, ...ctx });
    if (!res.ok) return res;
    s = res.state;
  }
  return ok(s);
}

/** Run a single named effect on `iid` (used by manual activation). */
export function runEffect(
  state: GameState,
  iid: string,
  effectId: string,
  ctx: Omit<EffectContext, "iid" | "seat">,
): ApplyResult {
  const inst = getInst(state, iid);
  const def = getDef(state, iid);
  if (!resolvedEffectIds(def).includes(effectId)) return err("That card has no such ability.");
  const eff = EFFECTS[effectId];
  if (!eff) return err("Unknown effect.");
  return eff.run(state, { iid, seat: inst.controller, ...ctx });
}

export { opponentOf, withPlayer };
