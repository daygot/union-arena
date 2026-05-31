import { describe, it, expect, beforeEach } from "vitest";
import { createGame, __resetIidCounter } from "./setup.js";
import { apForTurn } from "./rules.js";
import { shuffle } from "./rng.js";
import type { CardDef, Seat } from "./types.js";

function makeDef(id: string): CardDef {
  return {
    id,
    cardNumber: id,
    sourceCode: "TST",
    name: id,
    type: "character",
    color: "red",
    requiredEnergy: [{ color: "red", amount: 1 }],
    apCost: 1,
    bp: 1000,
    energyGeneration: [{ color: "red", amount: 1 }],
    affinities: [],
    keywords: [],
    hasTrigger: false,
    effectIds: [],
    text: "",
  };
}

function makeDeckListIds(): string[] {
  // 50 cards, <=4 per number: 13 distinct numbers, mostly x4.
  const ids: string[] = [];
  for (let n = 0; n < 13; n++) {
    const copies = n === 12 ? 2 : 4; // 12*4 + 2 = 50
    for (let c = 0; c < copies; c++) ids.push(`TST-1-${String(n).padStart(3, "0")}`);
  }
  return ids;
}

const defs: Record<string, CardDef> = {};
for (let n = 0; n < 13; n++) {
  const id = `TST-1-${String(n).padStart(3, "0")}`;
  defs[id] = makeDef(id);
}
defs["TST-AP"] = { ...makeDef("TST-AP"), type: "site", name: "AP" };

function newGame(seed: number) {
  __resetIidCounter();
  const cards = makeDeckListIds();
  return createGame({
    seed,
    defs,
    decks: {
      p1: { cards, apCardId: "TST-AP" },
      p2: { cards, apCardId: "TST-AP" },
    },
  });
}

describe("setup", () => {
  beforeEach(() => __resetIidCounter());

  it("deals 7 hand, 7 life, 3 AP, rest in deck for each player", () => {
    const g = newGame(42);
    for (const seat of ["p1", "p2"] as Seat[]) {
      const p = g.players[seat];
      expect(p.hand).toHaveLength(7);
      expect(p.life).toHaveLength(7);
      expect(p.ap).toHaveLength(3);
      // 50 - 7 hand - 7 life = 36 left in deck
      expect(p.deck).toHaveLength(36);
    }
  });

  it("is deterministic: same seed -> identical hands", () => {
    const a = newGame(123);
    const b = newGame(123);
    expect(b.players.p1.hand).toEqual(a.players.p1.hand);
    expect(b.players.p2.hand).toEqual(a.players.p2.hand);
  });

  it("different seeds -> different shuffles", () => {
    const a = newGame(1);
    const b = newGame(2);
    expect(b.players.p1.hand).not.toEqual(a.players.p1.hand);
  });
});

describe("rng.shuffle", () => {
  it("is a permutation and deterministic", () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8];
    const r1 = shuffle(input, 99);
    const r2 = shuffle(input, 99);
    expect(r1.result).toEqual(r2.result);
    expect([...r1.result].sort((x, y) => x - y)).toEqual(input);
  });
});

describe("apForTurn", () => {
  it("matches the rulebook table", () => {
    expect(apForTurn("p1", 1)).toBe(1);
    expect(apForTurn("p1", 2)).toBe(2);
    expect(apForTurn("p1", 3)).toBe(3);
    expect(apForTurn("p1", 9)).toBe(3);
    expect(apForTurn("p2", 1)).toBe(2);
    expect(apForTurn("p2", 2)).toBe(2);
    expect(apForTurn("p2", 3)).toBe(3);
  });
});
