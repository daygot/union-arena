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

const BUFF_EOT = 3000;

/** Grant a "until end of turn" BP modifier to one instance. */
function buff(state: GameState, iid: string, amount: number): GameState {
  return withInstance(state, iid, (i) => ({ ...i, bpModifier: (i.bpModifier ?? 0) + amount }));
}

/** A character is "on your field" if it's in your front or energy line. */
function onField(state: GameState, seat: Seat, iid: string): boolean {
  const p = state.players[seat];
  return p.frontLine.includes(iid) || p.energyLine.includes(iid);
}

function drawOne(state: GameState, seat: Seat): GameState {
  const deck = state.players[seat].deck;
  if (deck.length === 0) return state;
  const [top, ...rest] = deck;
  return withPlayer(state, seat, (p) => ({ ...p, deck: rest, hand: [...p.hand, top!] }));
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

// ---- Registry ----------------------------------------------------------------

export const EFFECTS: Record<string, EffectDef> = {
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

  // "This character gains 3000 BP until end of turn." (self buff on play/activate)
  buff_self_3000_eot: {
    id: "buff_self_3000_eot",
    when: "activate",
    text: "This character gains 3000 BP until end of turn.",
    run: (state, ctx) => ok(buff(state, ctx.iid, BUFF_EOT)),
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
  return def.effectIds
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
  if (!def.effectIds.includes(effectId)) return err("That card has no such ability.");
  const eff = EFFECTS[effectId];
  if (!eff) return err("Unknown effect.");
  return eff.run(state, { iid, seat: inst.controller, ...ctx });
}

export { opponentOf, withPlayer };
