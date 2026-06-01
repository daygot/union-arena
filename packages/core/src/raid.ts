import { err, getDef, hasRequiredEnergy, ok, withInstance, withPlayer } from "./helpers.js";
import type { ApplyResult, GameState, Seat } from "./types.js";

export interface RaidInput {
  seat: Seat;
  raidIid: string;
  targetIid: string;
}

/**
 * Shared Raid stack primitive.
 *
 * Callers are responsible for removing the raid card from its source zone and
 * paying costs. This helper validates the Raid/base relationship, replaces the
 * base in its field slot with the raid card, and leaves underlying cards off-zone
 * under `raidUnder`.
 */
export function performRaid(state: GameState, input: RaidInput): ApplyResult {
  const { seat, raidIid, targetIid } = input;
  const raidDef = getDef(state, raidIid);
  const base = state.instances[targetIid];
  const player = state.players[seat];

  if (raidDef.type !== "character" || !raidDef.keywords.includes("raid")) {
    return err("Raid card must be a character with Raid.");
  }

  const onFront = player.frontLine.includes(targetIid);
  const onEnergy = player.energyLine.includes(targetIid);
  if (!base || base.controller !== seat || (!onFront && !onEnergy)) {
    return err("Raid target must be your own field character.");
  }

  const baseDef = getDef(state, targetIid);
  if (baseDef.type !== "character") return err("Raid target must be a character.");
  if (baseDef.keywords.includes("raid") || base.raidUnder.length > 0) {
    return err("Raid target cannot already have Raid.");
  }
  if (!hasRequiredEnergy(state, seat, raidDef)) {
    return err("Not enough energy to Raid this card.");
  }

  let s = withInstance(state, raidIid, (i) => ({
    ...i,
    owner: seat,
    controller: seat,
    orientation: "active",
    raidUnder: [targetIid, ...base.raidUnder],
    faceUp: true,
    bpModifier: 0,
  }));

  s = withPlayer(s, seat, (p) => ({
    ...p,
    frontLine: onFront
      ? p.frontLine.map((x) => (x === targetIid ? raidIid : x))
      : p.frontLine,
    energyLine: onEnergy
      ? p.energyLine.map((x) => (x === targetIid ? raidIid : x))
      : p.energyLine,
  }));

  return ok(s);
}
