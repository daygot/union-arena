// Pure state helpers for the engine. No intent logic here.
import type {
  ApplyResult,
  CardDef,
  CardInstance,
  Color,
  GameState,
  PlayerState,
  Seat,
} from "./types.js";

/** Shared result constructors. */
export function err(error: string): ApplyResult {
  return { ok: false, error };
}
export function ok(state: GameState): ApplyResult {
  return { ok: true, state };
}

export function opponentOf(seat: Seat): Seat {
  return seat === "p1" ? "p2" : "p1";
}

export function getDef(state: GameState, iid: string): CardDef {
  const inst = state.instances[iid];
  if (!inst) throw new Error(`No instance ${iid}`);
  const def = state.defs[inst.defId];
  if (!def) throw new Error(`No def ${inst.defId}`);
  return def;
}

/** BP including temporary modifiers (e.g. active-trigger +3000). */
export function effectiveBp(state: GameState, iid: string): number {
  const def = getDef(state, iid);
  const inst = getInst(state, iid);
  return (def.bp ?? 0) + (inst.bpModifier ?? 0);
}

export function getInst(state: GameState, iid: string): CardInstance {
  const inst = state.instances[iid];
  if (!inst) throw new Error(`No instance ${iid}`);
  return inst;
}

/** Total energy generated per color from a player's energy line (front-line ignored). */
export function energyPool(state: GameState, seat: Seat): Record<Color, number> {
  const pool: Record<Color, number> = {
    red: 0,
    blue: 0,
    green: 0,
    yellow: 0,
    purple: 0,
  };
  for (const iid of state.players[seat].energyLine) {
    const def = getDef(state, iid);
    for (const e of def.energyGeneration) pool[e.color] += e.amount;
  }
  return pool;
}

/** Does the player's energy line satisfy a card's required energy? */
export function hasRequiredEnergy(state: GameState, seat: Seat, def: CardDef): boolean {
  const pool = energyPool(state, seat);
  for (const req of def.requiredEnergy) {
    if (pool[req.color] < req.amount) return false;
  }
  return true;
}

/** Count of active AP cards a player can still spend. */
export function activeApCount(state: GameState, seat: Seat): number {
  return state.players[seat].ap.filter((iid) => getInst(state, iid).orientation === "active").length;
}

// ---- Immutable update helpers ----

export function withPlayer(
  state: GameState,
  seat: Seat,
  update: (p: PlayerState) => PlayerState,
): GameState {
  return {
    ...state,
    players: { ...state.players, [seat]: update(state.players[seat]) },
  };
}

export function withInstance(
  state: GameState,
  iid: string,
  update: (i: CardInstance) => CardInstance,
): GameState {
  return {
    ...state,
    instances: { ...state.instances, [iid]: update(getInst(state, iid)) },
  };
}

/** Pay `cost` AP by switching that many active AP cards to resting. Assumes availability checked. */
export function payAp(state: GameState, seat: Seat, cost: number): GameState {
  let s = state;
  let remaining = cost;
  for (const iid of s.players[seat].ap) {
    if (remaining <= 0) break;
    if (getInst(s, iid).orientation === "active") {
      s = withInstance(s, iid, (i) => ({ ...i, orientation: "resting" }));
      remaining--;
    }
  }
  return s;
}

/** Remove an iid from whatever player-zone arrays it sits in (lightweight; caller knows the zone). */
export function removeFrom(arr: string[], iid: string): string[] {
  return arr.filter((x) => x !== iid);
}
