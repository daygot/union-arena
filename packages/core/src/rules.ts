// Pure rule helpers (no state mutation). Testable in isolation.
import type { Seat } from "./types.js";

/**
 * AP cards available at the start phase of a given turn.
 * P1: T1=1, T2=2, T3+=3.  P2: T1=2, T2=2, T3+=3.
 */
export function apForTurn(seat: Seat, turn: number): number {
  if (turn >= 3) return 3;
  if (seat === "p1") return turn === 1 ? 1 : 2;
  // p2
  return 2;
}
