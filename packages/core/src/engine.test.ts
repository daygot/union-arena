import { describe, it, expect } from "vitest";
import { applyIntent, beginFirstTurn } from "./engine.js";
import { createGame, __resetIidCounter } from "./setup.js";
import type { ApplyResult, CardDef, GameState, Keyword, Seat } from "./types.js";

function def(partial: Partial<CardDef> & { id: string }): CardDef {
  return {
    cardNumber: partial.id,
    sourceCode: "TST",
    name: partial.id,
    type: "character",
    color: "red",
    requiredEnergy: [],
    apCost: 1,
    bp: 1000,
    energyGeneration: [{ color: "red", amount: 1 }],
    affinities: [],
    keywords: [],
    hasTrigger: false,
    effectIds: [],
    text: "",
    ...partial,
  };
}

// Card library for tests.
const DEFS: Record<string, CardDef> = {};
function reg(d: CardDef) {
  DEFS[d.id] = d;
}
reg(def({ id: "ENERGY", energyGeneration: [{ color: "red", amount: 1 }], apCost: 0, requiredEnergy: [] }));
reg(def({ id: "BIG", bp: 3000, apCost: 1, requiredEnergy: [{ color: "red", amount: 1 }] }));
reg(def({ id: "SMALL", bp: 1000, apCost: 1, requiredEnergy: [{ color: "red", amount: 1 }] }));
reg(def({ id: "STEP", bp: 1000, keywords: ["step"] as Keyword[] }));
reg(def({ id: "SNIPE", bp: 2000, keywords: ["snipe"] as Keyword[] }));
reg(def({ id: "IMPACT", bp: 1000, keywords: ["impact"] as Keyword[] }));
reg(def({ id: "AP", type: "site", name: "AP", energyGeneration: [], apCost: 0 }));

function must(r: ApplyResult): GameState {
  if (!r.ok) throw new Error(`Intent failed: ${r.error}`);
  return r.state;
}

/** Build a game with fully controlled zones. AP cards (3) are added by createGame. */
function fixture(opts: {
  p1?: Partial<Record<"frontLine" | "energyLine" | "hand" | "life", string[]>>;
  p2?: Partial<Record<"frontLine" | "energyLine" | "hand" | "life", string[]>>;
  activeSeat?: Seat;
  phase?: GameState["phase"];
  turn?: number;
}): GameState {
  __resetIidCounter();
  // Minimal legal-ish decks; we override zones after.
  const filler = Array.from({ length: 50 }, () => "SMALL");
  let g = createGame({
    seed: 1,
    defs: DEFS,
    decks: {
      p1: { cards: filler, apCardId: "AP" },
      p2: { cards: filler, apCardId: "AP" },
    },
  });

  // Helper to mint an instance from a def id in a given zone.
  let mintId = 100000;
  function place(seat: Seat, zone: "frontLine" | "energyLine" | "hand" | "life", defId: string) {
    const iid = `${seat}-${zone}-${mintId++}`;
    g.instances[iid] = {
      iid,
      defId,
      owner: seat,
      controller: seat,
      orientation: "active",
      raidUnder: [],
      faceUp: false,
    };
    g.players[seat][zone] = [...g.players[seat][zone], iid];
    return iid;
  }

  // Reset controlled zones then fill from opts.
  for (const seat of ["p1", "p2"] as Seat[]) {
    g.players[seat].frontLine = [];
    g.players[seat].energyLine = [];
    g.players[seat].hand = [];
    g.players[seat].life = g.players[seat].life; // keep 7 life by default
    const spec = (seat === "p1" ? opts.p1 : opts.p2) ?? {};
    for (const zone of ["energyLine", "frontLine", "hand", "life"] as const) {
      if (spec[zone]) {
        if (zone === "life") g.players[seat].life = [];
        for (const d of spec[zone]!) place(seat, zone, d);
      }
    }
  }

  g.activeSeat = opts.activeSeat ?? "p1";
  g.phase = opts.phase ?? "main";
  g.turn = opts.turn ?? 2; // turn 2 so both players draw and have AP
  return g;
}

describe("start phase + draw", () => {
  it("beginFirstTurn: P1 does not draw on turn 1, gets 1 AP active", () => {
    __resetIidCounter();
    const filler = Array.from({ length: 50 }, () => "SMALL");
    let g = createGame({
      seed: 5,
      defs: DEFS,
      decks: { p1: { cards: filler, apCardId: "AP" }, p2: { cards: filler, apCardId: "AP" } },
    });
    const handBefore = g.players.p1.hand.length;
    g = beginFirstTurn(g);
    expect(g.players.p1.hand.length).toBe(handBefore); // no draw
    const activeAp = g.players.p1.ap.filter((i) => g.instances[i]!.orientation === "active").length;
    expect(activeAp).toBe(1);
  });
});

describe("extra draw timing", () => {
  it("allows one AP-paid extra draw in start phase, rejects second", () => {
    let g = fixture({ phase: "start", turn: 2, activeSeat: "p1" });
    // ensure AP active
    for (const iid of g.players.p1.ap) g.instances[iid] = { ...g.instances[iid]!, orientation: "active" };
    const before = g.players.p1.hand.length;
    g = must(applyIntent(g, { type: "extraDraw", seat: "p1" }));
    expect(g.players.p1.hand.length).toBe(before + 1);
    const second = applyIntent(g, { type: "extraDraw", seat: "p1" });
    expect(second.ok).toBe(false);
  });

  it("rejects extra draw outside start phase", () => {
    const g = fixture({ phase: "main" });
    expect(applyIntent(g, { type: "extraDraw", seat: "p1" }).ok).toBe(false);
  });
});

describe("movement phase", () => {
  it("moves a character energy->front", () => {
    let g = fixture({ phase: "movement", p1: { energyLine: ["SMALL"] } });
    const iid = g.players.p1.energyLine[0]!;
    g = must(applyIntent(g, { type: "move", seat: "p1", iid, to: "frontLine" }));
    expect(g.players.p1.frontLine).toContain(iid);
    expect(g.players.p1.energyLine).not.toContain(iid);
  });

  it("blocks front->energy without Step, allows with Step", () => {
    let g = fixture({ phase: "movement", p1: { frontLine: ["SMALL", "STEP"] } });
    const small = g.players.p1.frontLine[0]!;
    const step = g.players.p1.frontLine[1]!;
    expect(applyIntent(g, { type: "move", seat: "p1", iid: small, to: "energyLine" }).ok).toBe(false);
    g = must(applyIntent(g, { type: "move", seat: "p1", iid: step, to: "energyLine" }));
    expect(g.players.p1.energyLine).toContain(step);
  });
});

describe("main phase: playing cards", () => {
  it("plays a character to front line, paying AP, entering resting", () => {
    let g = fixture({
      phase: "main",
      p1: { energyLine: ["ENERGY"], hand: ["BIG"] },
    });
    const hand = g.players.p1.hand[0]!;
    const apBefore = g.players.p1.ap.filter((i) => g.instances[i]!.orientation === "active").length;
    g = must(applyIntent(g, { type: "playCard", seat: "p1", iid: hand, to: "frontLine" }));
    expect(g.players.p1.frontLine).toContain(hand);
    expect(g.instances[hand]!.orientation).toBe("resting");
    const apAfter = g.players.p1.ap.filter((i) => g.instances[i]!.orientation === "active").length;
    expect(apAfter).toBe(apBefore - 1);
  });

  it("rejects play without required energy", () => {
    const g = fixture({ phase: "main", p1: { hand: ["BIG"] } }); // no energy line
    expect(applyIntent(g, { type: "playCard", seat: "p1", iid: g.players.p1.hand[0]!, to: "frontLine" }).ok).toBe(false);
  });

  it("forces sites to the energy line", () => {
    let g = fixture({ phase: "main", p1: { energyLine: ["ENERGY"], hand: ["AP"] } });
    const site = g.players.p1.hand[0]!;
    expect(applyIntent(g, { type: "playCard", seat: "p1", iid: site, to: "frontLine" }).ok).toBe(false);
    g = must(applyIntent(g, { type: "playCard", seat: "p1", iid: site, to: "energyLine" }));
    expect(g.players.p1.energyLine).toContain(site);
  });
});

describe("attack phase: combat", () => {
  it("attacker BP >= defender BP sidelines the blocker", () => {
    let g = fixture({
      phase: "attack",
      p1: { frontLine: ["BIG"] }, // 3000
      p2: { frontLine: ["SMALL"] }, // 1000
    });
    const atk = g.players.p1.frontLine[0]!;
    const blk = g.players.p2.frontLine[0]!;
    g = must(applyIntent(g, { type: "declareAttack", seat: "p1", attackerIid: atk }));
    g = must(applyIntent(g, { type: "declareBlock", seat: "p2", blockerIid: blk }));
    expect(g.players.p2.sideline).toContain(blk);
    expect(g.players.p2.frontLine).not.toContain(blk);
    expect(g.instances[atk]!.orientation).toBe("resting"); // attacker switched to resting
  });

  it("attacker BP < defender BP: attacker loses but is NOT sidelined", () => {
    let g = fixture({
      phase: "attack",
      p1: { frontLine: ["SMALL"] }, // 1000
      p2: { frontLine: ["BIG"] }, // 3000
    });
    const atk = g.players.p1.frontLine[0]!;
    const blk = g.players.p2.frontLine[0]!;
    g = must(applyIntent(g, { type: "declareAttack", seat: "p1", attackerIid: atk }));
    g = must(applyIntent(g, { type: "declareBlock", seat: "p2", blockerIid: blk }));
    expect(g.players.p1.sideline).not.toContain(atk); // attacker survives
    expect(g.players.p2.frontLine).toContain(blk); // blocker survives
  });

  it("unblocked attack deals 1 damage; defender resolves a trigger reveal", () => {
    let g = fixture({
      phase: "attack",
      p1: { frontLine: ["SMALL"] },
      p2: { life: ["SMALL", "SMALL", "SMALL"] },
    });
    const atk = g.players.p1.frontLine[0]!;
    g = must(applyIntent(g, { type: "declareAttack", seat: "p1", attackerIid: atk }));
    g = must(applyIntent(g, { type: "declareBlock", seat: "p2" })); // no blocker
    expect(g.pendingTriggers?.seat).toBe("p2");
    expect(g.pendingTriggers?.iids.length).toBe(1);
    const revealed = g.pendingTriggers!.iids[0]!;
    g = must(applyIntent(g, { type: "resolveTrigger", seat: "p2", iid: revealed, activate: false }));
    expect(g.players.p2.life.length).toBe(2);
    expect(g.players.p2.sideline).toContain(revealed);
  });

  it("Impact pushes damage through even when blocked", () => {
    let g = fixture({
      phase: "attack",
      p1: { frontLine: ["IMPACT"] }, // 1000 + impact
      p2: { frontLine: ["BIG"], life: ["SMALL", "SMALL"] }, // blocker 3000
    });
    const atk = g.players.p1.frontLine[0]!;
    const blk = g.players.p2.frontLine[0]!;
    g = must(applyIntent(g, { type: "declareAttack", seat: "p1", attackerIid: atk }));
    g = must(applyIntent(g, { type: "declareBlock", seat: "p2", blockerIid: blk }));
    // attacker lost the battle (1000 < 3000) but Impact still deals damage -> pending triggers
    expect(g.pendingTriggers?.seat).toBe("p2");
    expect(g.pendingTriggers?.iids.length).toBe(1);
  });

  it("Snipe attacks a front-line character and cannot be blocked", () => {
    let g = fixture({
      phase: "attack",
      p1: { frontLine: ["SNIPE"] }, // 2000
      p2: { frontLine: ["SMALL"] }, // 1000 target
    });
    const atk = g.players.p1.frontLine[0]!;
    const target = g.players.p2.frontLine[0]!;
    g = must(applyIntent(g, { type: "declareAttack", seat: "p1", attackerIid: atk, targetIid: target }));
    g = must(applyIntent(g, { type: "declareBlock", seat: "p2" }));
    expect(g.players.p2.sideline).toContain(target); // 2000 >= 1000 -> sidelined
  });

  it("reducing life to zero wins the game", () => {
    let g = fixture({
      phase: "attack",
      p1: { frontLine: ["SMALL"] },
      p2: { life: ["SMALL"] }, // only 1 life
    });
    const atk = g.players.p1.frontLine[0]!;
    g = must(applyIntent(g, { type: "declareAttack", seat: "p1", attackerIid: atk }));
    g = must(applyIntent(g, { type: "declareBlock", seat: "p2" }));
    const revealed = g.pendingTriggers!.iids[0]!;
    g = must(applyIntent(g, { type: "resolveTrigger", seat: "p2", iid: revealed, activate: false }));
    expect(g.winner).toBe("p1");
  });
});

describe("phase advancement & turn pass", () => {
  it("advances through phases then passes the turn and runs opponent start phase", () => {
    let g = fixture({ phase: "main", turn: 2, activeSeat: "p1" });
    g = must(applyIntent(g, { type: "advancePhase", seat: "p1" })); // -> attack
    expect(g.phase).toBe("attack");
    g = must(applyIntent(g, { type: "advancePhase", seat: "p1" })); // -> end
    expect(g.phase).toBe("end");
    const p2HandBefore = g.players.p2.hand.length;
    const p2DeckBefore = g.players.p2.deck.length;
    g = must(applyIntent(g, { type: "advancePhase", seat: "p1" })); // -> p2 start
    expect(g.activeSeat).toBe("p2");
    expect(g.phase).toBe("start");
    expect(g.turn).toBe(3);
    // p2 drew at start of its turn
    expect(g.players.p2.hand.length).toBe(p2HandBefore + 1);
    expect(g.players.p2.deck.length).toBe(p2DeckBefore - 1);
  });

  it("end phase discards down to 8 cards", () => {
    let g = fixture({ phase: "end", turn: 2, activeSeat: "p1" });
    // stuff 10 cards into hand
    const extra: string[] = [];
    let i = 200000;
    for (let k = 0; k < 10; k++) {
      const iid = `p1-h-${i++}`;
      g.instances[iid] = { iid, defId: "SMALL", owner: "p1", controller: "p1", orientation: "active", raidUnder: [], faceUp: false };
      extra.push(iid);
    }
    g.players.p1.hand = extra;
    g = must(applyIntent(g, { type: "advancePhase", seat: "p1" }));
    expect(g.players.p1.hand.length).toBe(8);
    expect(g.players.p1.removal.length).toBe(2);
  });
});

describe("turn enforcement", () => {
  it("rejects intents from the non-active player", () => {
    const g = fixture({ phase: "main", activeSeat: "p1" });
    expect(applyIntent(g, { type: "advancePhase", seat: "p2" }).ok).toBe(false);
  });
});
