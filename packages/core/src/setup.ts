// Game setup: build instances from decklists and run the opening procedure.
import type { CardDef, GameState, PlayerState, Seat } from "./types.js";
import { shuffle } from "./rng.js";

export interface DeckList {
  /** 50 CardDef ids (with repeats) forming the main deck. */
  cards: string[];
  /** AP card def id (3 copies are added automatically). */
  apCardId: string;
}

let iidCounter = 0;
function makeIid(prefix: string): string {
  iidCounter += 1;
  return `${prefix}-${iidCounter}`;
}

/** Reset the instance id counter (tests want deterministic iids). */
export function __resetIidCounter(): void {
  iidCounter = 0;
}

function emptyPlayer(seat: Seat): PlayerState {
  return {
    seat,
    deck: [],
    hand: [],
    frontLine: [],
    energyLine: [],
    life: [],
    ap: [],
    sideline: [],
    removal: [],
    hasMulliganed: false,
    extraDrawUsedThisTurn: false,
  };
}

export interface CreateGameOptions {
  seed: number;
  defs: Record<string, CardDef>;
  decks: Record<Seat, DeckList>;
}

/**
 * Create a new game: build instances, shuffle decks, draw opening hands (7),
 * set 7 life cards face-down, place 3 AP cards. Mulligan is a separate intent.
 */
export function createGame(opts: CreateGameOptions): GameState {
  const { seed, defs, decks } = opts;
  const instances: GameState["instances"] = {};
  let rngState = seed | 0;

  const players: Record<Seat, PlayerState> = {
    p1: emptyPlayer("p1"),
    p2: emptyPlayer("p2"),
  };

  for (const seat of ["p1", "p2"] as const) {
    const list = decks[seat];
    // Build 50 main-deck instances.
    const deckIids: string[] = [];
    for (const defId of list.cards) {
      const iid = makeIid(`${seat}-c`);
      instances[iid] = {
        iid,
        defId,
        owner: seat,
        controller: seat,
        orientation: "active",
        raidUnder: [],
        faceUp: false,
      };
      deckIids.push(iid);
    }
    // Shuffle.
    const sh = shuffle(deckIids, rngState);
    rngState = sh.state;
    let deck = sh.result;

    // 7-card opening hand.
    const hand = deck.slice(0, 7);
    deck = deck.slice(7);
    // 7 life cards face-down.
    const life = deck.slice(0, 7);
    deck = deck.slice(7);

    // 3 AP cards (separate from the 50).
    const ap: string[] = [];
    for (let i = 0; i < 3; i++) {
      const iid = makeIid(`${seat}-ap`);
      instances[iid] = {
        iid,
        defId: list.apCardId,
        owner: seat,
        controller: seat,
        orientation: "active",
        raidUnder: [],
        faceUp: false,
      };
      ap.push(iid);
    }

    players[seat] = {
      ...emptyPlayer(seat),
      deck,
      hand,
      life,
      ap,
    };
  }

  return {
    rngState,
    turn: 1,
    activeSeat: "p1",
    phase: "start",
    players,
    instances,
    defs,
    log: [{ kind: "info", message: "Game created." }],
  };
}
