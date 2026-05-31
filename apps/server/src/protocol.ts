// Wire protocol between web clients and the authoritative server.
// Clients only ever PROPOSE intents; the server is the sole owner of GameState.
import type { GameState, Intent, Seat } from "@union-arena/core";

/** Messages a client sends to the server. */
export type ClientMessage =
  | { type: "join"; roomId: string }
  | { type: "intent"; intent: Intent };

/** Messages the server sends to a client. */
export type ServerMessage =
  | { type: "joined"; roomId: string; seat: Seat | "spectator" }
  | { type: "state"; state: GameState }
  | { type: "error"; error: string };
