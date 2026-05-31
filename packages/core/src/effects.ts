// Card ability system.
//
// Cards reference named effects via `CardDef.effectIds`. Each effect id maps to an
// EffectDef in the registry, with a `when` trigger (when it fires) and a pure `run`
// resolver. Effect ids are inferred from official card text by the card-data mapper
// (pattern matching), so real cards get real behavior without hand-tagging each one.
//
// This is intentionally small and data-driven: add new ids + patterns as sets land.
import type { ApplyResult, GameState, Seat } from "./types.js";
import { effectiveBp, err, getDef, getInst, ok, opponentOf, withInstance, withPlayer } from "./helpers.js";

/** When an effect fires. */
export type EffectTrigger =
  | "onPlay" // when the card is played from hand to the field
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

// ---- Registry ----------------------------------------------------------------

export const EFFECTS: Record<string, EffectDef> = {
  // "Choose up to one other character on your field. It gains 3000 BP until end of turn."
  // (SMD-1-001 on-play). Target optional ("up to one"); no target = fizzle (legal).
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
