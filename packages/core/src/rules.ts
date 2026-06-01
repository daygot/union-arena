// Pure rule helpers (no state mutation). Testable in isolation.
import type { Seat } from "./types.js";

/**
 * AP cards available at the start phase of a given player's personal turn.
 * P1: T1=1, T2=2, T3+=3.  P2: T1=2, T2=2, T3+=3.
 */
export function apForTurn(seat: Seat, playerTurn: number): number {
  if (playerTurn >= 3) return 3;
  if (seat === "p1") return playerTurn === 1 ? 1 : 2;
  // p2
  return 2;
}

/** Convert the shared half-turn counter into the active player's personal turn count. */
export function playerTurnNumber(seat: Seat, turn: number): number {
  return seat === "p1" ? Math.ceil(turn / 2) : Math.floor((turn + 1) / 2);
}
