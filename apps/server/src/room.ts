// A GameRoom owns one authoritative GameState. It is the ONLY place state mutates.
// Clients send intents; the room validates them via the core engine and broadcasts.
import {
  applyIntent,
  beginFirstTurn,
  createGame,
  __resetIidCounter,
  type GameState,
  type Intent,
  type Seat,
} from "@union-arena/core";
import { demoDeck, loadCards, type LoadedCards } from "./decks.js";

export interface Seated {
  seat: Seat;
  send: (msg: unknown) => void;
}

export class GameRoom {
  readonly id: string;
  private state: GameState;
  private clients = new Map<Seat, Seated>();
  private spectators = new Set<(msg: unknown) => void>();
  private readonly loaded: LoadedCards;

  constructor(id: string, loaded: LoadedCards, seed = Date.now() & 0x7fffffff) {
    this.id = id;
    this.loaded = loaded;
    __resetIidCounter();
    const deck = demoDeck(loaded);
    this.state = createGame({
      seed,
      defs: loaded.defs,
      decks: { p1: deck, p2: deck },
    });
  }

  /** Assign the next open seat, else spectator. */
  join(send: (msg: unknown) => void): Seat | "spectator" {
    for (const seat of ["p1", "p2"] as Seat[]) {
      if (!this.clients.has(seat)) {
        this.clients.set(seat, { seat, send });
        return seat;
      }
    }
    this.spectators.add(send);
    return "spectator";
  }

  leave(seat: Seat | "spectator", send: (msg: unknown) => void): void {
    if (seat === "spectator") this.spectators.delete(send);
    else if (this.clients.get(seat)?.send === send) this.clients.delete(seat);
  }

  /** Apply a client-proposed intent. Returns an error string if rejected. */
  submit(seat: Seat | "spectator", intent: Intent): string | null {
    if (seat === "spectator") return "Spectators cannot act.";
    if (intent.seat !== seat) return "You can only act for your own seat.";
    this.state = this.withFreshDefs(this.state);
    if (this.awaitingMulligans() && intent.type !== "mulligan") {
      return "Both players must finish mulligan decisions before the game starts.";
    }
    const res = applyIntent(this.state, intent);
    if (!res.ok) return res.error;
    this.state = res.state;
    if (this.awaitingMulligans() === false && this.state.turn === 1 && this.state.phase === "start") {
      const alreadyStarted = this.state.log.some((event) => event.kind === "phase");
      if (!alreadyStarted) this.state = beginFirstTurn(this.state);
    }
    this.broadcast();
    return null;
  }

  private awaitingMulligans(): boolean {
    return (
      this.state.turn === 1 &&
      this.state.phase === "start" &&
      (!this.state.players.p1.hasMulliganed || !this.state.players.p2.hasMulliganed)
    );
  }

  getState(): GameState {
    this.state = this.withFreshDefs(this.state);
    return this.state;
  }

  broadcast(): void {
    this.state = this.withFreshDefs(this.state);
    const msg = { type: "state", state: this.state };
    for (const c of this.clients.values()) c.send(msg);
    for (const s of this.spectators) s(msg);
  }

  private withFreshDefs(state: GameState): GameState {
    let changed = false;
    const defs: GameState["defs"] = {};
    for (const [defId, def] of Object.entries(state.defs)) {
      const fresh = this.loaded.defs[defId] ?? this.loaded.defs[def.cardNumber];
      defs[defId] = fresh ?? def;
      if (fresh && fresh !== def) changed = true;
    }
    return changed ? { ...state, defs } : state;
  }
}

let shared: LoadedCards | null = null;
export function sharedCards(): LoadedCards {
  if (!shared) shared = loadCards();
  return shared;
}
