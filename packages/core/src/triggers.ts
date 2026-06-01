// Hard-coded Life-Area trigger resolution. These 6 trigger types are fixed by the
// game's rules (user-confirmed 2026-05-31) and never vary per card, so they are encoded
// directly rather than as data-driven card effects.
//
// Terminology:
// - "trigger player" = the player who was attacked and revealed the life card.
// - "trigger source" = the revealed life card whose Trigger is firing.
// All triggers are OPTIONAL: if `activate` is false (or a required target is missing/illegal),
// the trigger fizzles with no effect. After resolution the revealed card goes to the trigger
// player's sideline, EXCEPT `get` (goes to hand).
import {
  getDef,
  getInst,
  opponentOf,
  withInstance,
  withPlayer,
  removeFrom,
} from "./helpers.js";
import type { ApplyResult, Color, GameState, Seat, TriggerType } from "./types.js";
import { err, ok } from "./helpers.js";
import { performRaid } from "./raid.js";

export interface TriggerInput {
  /** The trigger player (attacked / revealed). */
  seat: Seat;
  /** The revealed life card (trigger source). */
  iid: string;
  activate: boolean;
  /** Target character iid for active/special/color(red,blue). */
  targetIid?: string;
  /** Card iid to play for color(green=from hand, purple=from sideline). */
  playIid?: string;
}

const ACTIVE_BP_BONUS = 3000;
const RED_MAX_BP = 2500;
const BLUE_MAX_BP = 3500;
const COLOR_PLAY_MAX_AP = 2; // green/purple: "2c or less"

/** Move the revealed trigger source out of limbo into the sideline (default disposition). */
function sourceToSideline(state: GameState, seat: Seat, iid: string): GameState {
  return withPlayer(state, seat, (p) => ({ ...p, sideline: [...p.sideline, iid] }));
}

/** Resolve a single trigger by its fixed type. Returns the updated state (source already disposed). */
export function resolveTriggerEffect(
  state: GameState,
  triggerType: TriggerType | "none",
  input: TriggerInput,
): ApplyResult {
  const { seat, iid, activate } = input;

  // Declined (or no-trigger card): just sideline the source.
  if (!activate) return ok(sourceToSideline(state, seat, iid));

  switch (triggerType) {
    case "get":
      return resolveGet(state, seat, iid);
    case "draw":
      return resolveDraw(state, seat, iid);
    case "active":
      return resolveActive(state, input);
    case "special":
      return resolveSpecial(state, input);
    case "final":
      return resolveFinal(state, seat, iid);
    case "raid":
      return resolveRaid(state, input);
    case "color":
      return resolveColor(state, input);
    default:
      // Unknown / "none": no effect, sideline the source.
      return ok(sourceToSideline(state, seat, iid));
  }
}

// 1. get — the revealed card is added to the trigger player's hand.
function resolveGet(state: GameState, seat: Seat, iid: string): ApplyResult {
  const s = withPlayer(state, seat, (p) => ({ ...p, hand: [...p.hand, iid] }));
  return ok(withInstance(s, iid, (i) => ({ ...i, faceUp: false })));
}

// 2. draw — the trigger player draws 1 card.
function resolveDraw(state: GameState, seat: Seat, iid: string): ApplyResult {
  let s = sourceToSideline(state, seat, iid);
  const deck = s.players[seat].deck;
  if (deck.length > 0) {
    const [top, ...rest] = deck;
    s = withPlayer(s, seat, (p) => ({ ...p, deck: rest, hand: [...p.hand, top!] }));
  }
  return ok(s);
}

// 3. active — choose one of YOUR characters, switch to active, +3000 BP until end of turn.
function resolveActive(state: GameState, input: TriggerInput): ApplyResult {
  const { seat, iid, targetIid } = input;
  if (!targetIid) return ok(sourceToSideline(state, seat, iid)); // fizzle
  const inst = state.instances[targetIid];
  if (!inst || inst.controller !== seat || !state.players[seat].frontLine.includes(targetIid)) {
    return err("active trigger target must be your own front-line character.");
  }
  let s = sourceToSideline(state, seat, iid);
  s = withInstance(s, targetIid, (i) => ({
    ...i,
    orientation: "active",
    bpModifier: (i.bpModifier ?? 0) + ACTIVE_BP_BONUS,
  }));
  return ok(s);
}

// 5. special — sideline one character on the OPPONENT's front line (any BP).
function resolveSpecial(state: GameState, input: TriggerInput): ApplyResult {
  const { seat, iid, targetIid } = input;
  const opp = opponentOf(seat);
  if (!targetIid) return ok(sourceToSideline(state, seat, iid)); // fizzle
  if (!state.players[opp].frontLine.includes(targetIid)) {
    return err("special trigger must target an opponent front-line character.");
  }
  let s = sourceToSideline(state, seat, iid);
  s = sidelineCharacter(s, targetIid);
  return ok(s);
}

// 6. final — if this is your LAST life, put the top of your deck into your life area.
function resolveFinal(state: GameState, seat: Seat, iid: string): ApplyResult {
  // At this point the source has already been removed from `life` during the damage reveal,
  // so "last life" means the player now has 0 life remaining.
  const isLast = state.players[seat].life.length === 0;
  let s = sourceToSideline(state, seat, iid);
  if (isLast) {
    const deck = s.players[seat].deck;
    if (deck.length > 0) {
      const [top, ...rest] = deck;
      s = withPlayer(s, seat, (p) => ({ ...p, deck: rest, life: [...p.life, top!] }));
      s = withInstance(s, top!, (i) => ({ ...i, faceUp: false }));
    }
  }
  return ok(s);
}

// 7. raid — EITHER perform Raid with the revealed card onto one of your field characters
//    (if you meet its energy requirement), OR just add the card to hand.
//    With `activate` + a `targetIid` (the base char) we attempt the Raid; otherwise add to hand.
function resolveRaid(state: GameState, input: TriggerInput): ApplyResult {
  const { seat, iid, targetIid } = input;
  // No raid target chosen -> add the revealed card to hand.
  if (!targetIid) {
    const s = withPlayer(state, seat, (p) => ({ ...p, hand: [...p.hand, iid] }));
    return ok(withInstance(s, iid, (i) => ({ ...i, faceUp: false })));
  }
  return performRaid(state, { seat, raidIid: iid, targetIid });
}

// 4. color — effect depends on the revealed card's color.
function resolveColor(state: GameState, input: TriggerInput): ApplyResult {
  const { seat, iid } = input;
  const color: Color = getDef(state, iid).color;
  const opp = opponentOf(seat);

  switch (color) {
    case "red": {
      // Sideline one opponent front-liner with BP <= 2500.
      const t = input.targetIid;
      if (!t) return ok(sourceToSideline(state, seat, iid));
      if (!state.players[opp].frontLine.includes(t)) {
        return err("red color trigger must target an opponent front-line character.");
      }
      if (effectiveBp(state, t) > RED_MAX_BP) {
        return err(`red color trigger can only hit BP <= ${RED_MAX_BP}.`);
      }
      let s = sourceToSideline(state, seat, iid);
      return ok(sidelineCharacter(s, t));
    }
    case "blue": {
      // Bounce one opponent front-liner with BP <= 3500 to its owner's hand.
      const t = input.targetIid;
      if (!t) return ok(sourceToSideline(state, seat, iid));
      if (!state.players[opp].frontLine.includes(t)) {
        return err("blue color trigger must target an opponent front-line character.");
      }
      if (effectiveBp(state, t) > BLUE_MAX_BP) {
        return err(`blue color trigger can only bounce BP <= ${BLUE_MAX_BP}.`);
      }
      let s = sourceToSideline(state, seat, iid);
      return ok(bounceToHand(s, t));
    }
    case "green": {
      // Play a character (AP cost <= 2) from YOUR hand onto the field, active.
      const play = input.playIid;
      if (!play) return ok(sourceToSideline(state, seat, iid));
      if (!state.players[seat].hand.includes(play)) {
        return err("green color trigger must play a character from your hand.");
      }
      const pdef = getDef(state, play);
      if (pdef.type !== "character" || pdef.apCost > COLOR_PLAY_MAX_AP) {
        return err(`green color trigger can only play a character with AP cost <= ${COLOR_PLAY_MAX_AP}.`);
      }
      let s = sourceToSideline(state, seat, iid);
      s = withPlayer(s, seat, (p) => ({
        ...p,
        hand: removeFrom(p.hand, play),
        frontLine: [...p.frontLine, play],
      }));
      s = withInstance(s, play, (i) => ({ ...i, orientation: "active" }));
      return ok(s);
    }
    case "purple": {
      // Play a character (AP cost <= 2) from YOUR sideline onto the front line, active.
      const play = input.playIid;
      if (!play) return ok(sourceToSideline(state, seat, iid));
      if (!state.players[seat].sideline.includes(play)) {
        return err("purple color trigger must play a character from your sideline.");
      }
      const pdef = getDef(state, play);
      if (pdef.type !== "character" || pdef.apCost > COLOR_PLAY_MAX_AP) {
        return err(`purple color trigger can only play a character with AP cost <= ${COLOR_PLAY_MAX_AP}.`);
      }
      let s = sourceToSideline(state, seat, iid);
      s = withPlayer(s, seat, (p) => ({
        ...p,
        sideline: removeFrom(p.sideline, play),
        frontLine: [...p.frontLine, play],
      }));
      s = withInstance(s, play, (i) => ({ ...i, orientation: "active" }));
      return ok(s);
    }
    default:
      // Yellow (or other): no color trigger effect.
      return ok(sourceToSideline(state, seat, iid));
  }
}

// ---- shared helpers ----

function effectiveBp(state: GameState, iid: string): number {
  const def = getDef(state, iid);
  const inst = getInst(state, iid);
  return (def.bp ?? 0) + (inst.bpModifier ?? 0);
}

/** Remove a character from any field line and put it in its owner's sideline (active). */
function sidelineCharacter(state: GameState, iid: string): GameState {
  const inst = getInst(state, iid);
  let s = withPlayer(state, inst.controller, (p) => ({
    ...p,
    frontLine: removeFrom(p.frontLine, iid),
    energyLine: removeFrom(p.energyLine, iid),
  }));
  s = withPlayer(s, inst.owner, (p) => ({ ...p, sideline: [...p.sideline, iid] }));
  s = withInstance(s, iid, (i) => ({ ...i, orientation: "active", bpModifier: 0 }));
  return s;
}

/** Return a character from the field to its owner's hand. */
function bounceToHand(state: GameState, iid: string): GameState {
  const inst = getInst(state, iid);
  let s = withPlayer(state, inst.controller, (p) => ({
    ...p,
    frontLine: removeFrom(p.frontLine, iid),
    energyLine: removeFrom(p.energyLine, iid),
  }));
  s = withPlayer(s, inst.owner, (p) => ({ ...p, hand: [...p.hand, iid] }));
  s = withInstance(s, iid, (i) => ({ ...i, orientation: "active", bpModifier: 0, faceUp: false }));
  return s;
}
