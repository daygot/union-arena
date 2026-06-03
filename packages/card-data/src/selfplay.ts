import type { GameState, Intent, Seat } from "@union-arena/core";

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

