import { describe, it, expect } from "vitest";
import { resolveTriggerEffect } from "./triggers.js";
import { createGame, __resetIidCounter } from "./setup.js";
import type { CardDef, GameState, Seat, TriggerType } from "./types.js";

function def(p: Partial<CardDef> & { id: string }): CardDef {
  return {
    cardNumber: p.id,
    sourceCode: "TST",
    name: p.id,
    type: "character",
    color: "red",
    requiredEnergy: [],
    apCost: 1,
    bp: 1000,
    energyGeneration: [],
    affinities: [],
    keywords: [],
    hasTrigger: false,
    effectIds: [],
    text: "",
    ...p,
  };
}

const DEFS: Record<string, CardDef> = {
  FILLER: def({ id: "FILLER" }),
  AP: def({ id: "AP", type: "site" }),
  BP1000: def({ id: "BP1000", bp: 1000 }),
  BP2500: def({ id: "BP2500", bp: 2500 }),
  BP3000: def({ id: "BP3000", bp: 3000 }),
  BP4000: def({ id: "BP4000", bp: 4000 }),
  CHEAP: def({ id: "CHEAP", apCost: 2 }),
  EXPENSIVE: def({ id: "EXPENSIVE", apCost: 3 }),
  // trigger source cards (color drives the color trigger)
  RED: def({ id: "RED", color: "red", hasTrigger: true, triggerType: "color" }),
  BLUE: def({ id: "BLUE", color: "blue", hasTrigger: true, triggerType: "color" }),
  GREEN: def({ id: "GREEN", color: "green", hasTrigger: true, triggerType: "color" }),
  PURPLE: def({ id: "PURPLE", color: "purple", hasTrigger: true, triggerType: "color" }),
  // raid source needs 1 red energy
  RAIDER: def({
    id: "RAIDER",
    color: "red",
    requiredEnergy: [{ color: "red", amount: 1 }],
    keywords: ["raid"],
    hasTrigger: true,
    triggerType: "raid",
  }),
  // energy generator (sits on energy line, gives 1 red)
  GEN: def({ id: "GEN", energyGeneration: [{ color: "red", amount: 1 }] }),
};

let mint = 0;
function inst(g: GameState, seat: Seat, defId: string): string {
  const iid = `${seat}-${defId}-${mint++}`;
  g.instances[iid] = {
    iid,
    defId,
    owner: seat,
    controller: seat,
    orientation: "active",
    raidUnder: [],
    faceUp: false,
  };
  return iid;
}

/** Bare game with empty boards; we add exactly what each test needs. */
function bare(): GameState {
  __resetIidCounter();
  mint = 0;
  const filler = Array.from({ length: 50 }, () => "FILLER");
  const g = createGame({
    seed: 1,
    defs: DEFS,
    decks: { p1: { cards: filler, apCardId: "AP" }, p2: { cards: filler, apCardId: "AP" } },
  });
  for (const s of ["p1", "p2"] as Seat[]) {
    g.players[s].frontLine = [];
    g.players[s].energyLine = [];
    g.players[s].hand = [];
    g.players[s].sideline = [];
  }
  return g;
}

describe("get trigger", () => {
  it("adds the revealed card to the trigger player's hand", () => {
    const g = bare();
    const src = inst(g, "p1", "FILLER");
    const before = g.players.p1.hand.length;
    const r = resolveTriggerEffect(g, "get" as TriggerType, { seat: "p1", iid: src, activate: true });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.state.players.p1.hand).toContain(src);
      expect(r.state.players.p1.hand.length).toBe(before + 1);
      expect(r.state.players.p1.sideline).not.toContain(src);
    }
  });
});

describe("draw trigger", () => {
  it("draws 1 card and sidelines the source", () => {
    const g = bare();
    const src = inst(g, "p1", "FILLER");
    const handBefore = g.players.p1.hand.length;
    const deckBefore = g.players.p1.deck.length;
    const r = resolveTriggerEffect(g, "draw" as TriggerType, { seat: "p1", iid: src, activate: true });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.state.players.p1.hand.length).toBe(handBefore + 1);
      expect(r.state.players.p1.deck.length).toBe(deckBefore - 1);
      expect(r.state.players.p1.sideline).toContain(src);
    }
  });
});

describe("active trigger", () => {
  it("readies a chosen character and grants +3000 BP", () => {
    const g = bare();
    const target = inst(g, "p1", "BP1000");
    g.instances[target]!.orientation = "resting";
    g.players.p1.frontLine = [target];
    const src = inst(g, "p1", "FILLER");
    const r = resolveTriggerEffect(g, "active" as TriggerType, {
      seat: "p1",
      iid: src,
      activate: true,
      targetIid: target,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.state.instances[target]!.orientation).toBe("active");
      expect(r.state.instances[target]!.bpModifier).toBe(3000);
    }
  });

  it("rejects targeting an opponent's character", () => {
    const g = bare();
    const t = inst(g, "p2", "BP1000");
    g.players.p2.frontLine = [t];
    const src = inst(g, "p1", "FILLER");
    const r = resolveTriggerEffect(g, "active" as TriggerType, { seat: "p1", iid: src, activate: true, targetIid: t });
    expect(r.ok).toBe(false);
  });
});

describe("special trigger", () => {
  it("sidelines any opponent front-line character", () => {
    const g = bare();
    const t = inst(g, "p2", "BP4000");
    g.players.p2.frontLine = [t];
    const src = inst(g, "p1", "FILLER");
    const r = resolveTriggerEffect(g, "special" as TriggerType, { seat: "p1", iid: src, activate: true, targetIid: t });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.state.players.p2.sideline).toContain(t);
      expect(r.state.players.p2.frontLine).not.toContain(t);
    }
  });
});

describe("color trigger", () => {
  it("red: sidelines an opponent front-liner with BP <= 2500", () => {
    const g = bare();
    const ok = inst(g, "p2", "BP2500");
    const tooBig = inst(g, "p2", "BP3000");
    g.players.p2.frontLine = [ok, tooBig];
    const src = inst(g, "p1", "RED");
    const r1 = resolveTriggerEffect(g, "color" as TriggerType, { seat: "p1", iid: src, activate: true, targetIid: ok });
    expect(r1.ok).toBe(true);
    if (r1.ok) expect(r1.state.players.p2.sideline).toContain(ok);
    // 3000 is too big -> rejected
    const src2 = inst(g, "p1", "RED");
    const r2 = resolveTriggerEffect(g, "color" as TriggerType, { seat: "p1", iid: src2, activate: true, targetIid: tooBig });
    expect(r2.ok).toBe(false);
  });

  it("blue: bounces an opponent front-liner with BP <= 3500 to hand", () => {
    const g = bare();
    const t = inst(g, "p2", "BP3000");
    g.players.p2.frontLine = [t];
    const src = inst(g, "p1", "BLUE");
    const r = resolveTriggerEffect(g, "color" as TriggerType, { seat: "p1", iid: src, activate: true, targetIid: t });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.state.players.p2.hand).toContain(t);
      expect(r.state.players.p2.frontLine).not.toContain(t);
    }
  });

  it("blue: rejects bouncing a BP > 3500 character", () => {
    const g = bare();
    const t = inst(g, "p2", "BP4000");
    g.players.p2.frontLine = [t];
    const src = inst(g, "p1", "BLUE");
    const r = resolveTriggerEffect(g, "color" as TriggerType, { seat: "p1", iid: src, activate: true, targetIid: t });
    expect(r.ok).toBe(false);
  });

  it("green: plays a <=2 AP character from hand to front line, active", () => {
    const g = bare();
    const card = inst(g, "p1", "CHEAP");
    g.players.p1.hand = [card];
    const src = inst(g, "p1", "GREEN");
    const r = resolveTriggerEffect(g, "color" as TriggerType, { seat: "p1", iid: src, activate: true, playIid: card });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.state.players.p1.frontLine).toContain(card);
      expect(r.state.players.p1.hand).not.toContain(card);
      expect(r.state.instances[card]!.orientation).toBe("active");
    }
  });

  it("green: rejects playing a >2 AP character", () => {
    const g = bare();
    const card = inst(g, "p1", "EXPENSIVE");
    g.players.p1.hand = [card];
    const src = inst(g, "p1", "GREEN");
    const r = resolveTriggerEffect(g, "color" as TriggerType, { seat: "p1", iid: src, activate: true, playIid: card });
    expect(r.ok).toBe(false);
  });

  it("purple: plays a <=2 AP character from sideline to front line, active", () => {
    const g = bare();
    const card = inst(g, "p1", "CHEAP");
    g.players.p1.sideline = [card];
    const src = inst(g, "p1", "PURPLE");
    const r = resolveTriggerEffect(g, "color" as TriggerType, { seat: "p1", iid: src, activate: true, playIid: card });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.state.players.p1.frontLine).toContain(card);
      expect(r.state.players.p1.sideline).not.toContain(card);
    }
  });
});

describe("final trigger", () => {
  it("when it is the last life, puts top of deck into life", () => {
    const g = bare();
    // Player has 0 life remaining (source already removed during damage reveal).
    g.players.p1.life = [];
    const deckBefore = g.players.p1.deck.length;
    const src = inst(g, "p1", "FILLER");
    const r = resolveTriggerEffect(g, "final" as TriggerType, { seat: "p1", iid: src, activate: true });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.state.players.p1.life.length).toBe(1); // replenished
      expect(r.state.players.p1.deck.length).toBe(deckBefore - 1);
      expect(r.state.players.p1.sideline).toContain(src);
    }
  });

  it("does nothing extra when life remains", () => {
    const g = bare();
    g.players.p1.life = [inst(g, "p1", "FILLER")]; // still has 1 life
    const deckBefore = g.players.p1.deck.length;
    const src = inst(g, "p1", "FILLER");
    const r = resolveTriggerEffect(g, "final" as TriggerType, { seat: "p1", iid: src, activate: true });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.state.players.p1.life.length).toBe(1); // unchanged
      expect(r.state.players.p1.deck.length).toBe(deckBefore);
    }
  });
});

describe("raid trigger", () => {
  it("with a valid target and enough energy, raids onto the base character", () => {
    const g = bare();
    const gen = inst(g, "p1", "GEN");
    g.players.p1.energyLine = [gen];
    const base = inst(g, "p1", "BP1000");
    g.players.p1.frontLine = [base];
    const src = inst(g, "p1", "RAIDER");
    const r = resolveTriggerEffect(g, "raid" as TriggerType, {
      seat: "p1",
      iid: src,
      activate: true,
      targetIid: base,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      // Raid card is now the top of the stack in the base's slot.
      expect(r.state.players.p1.frontLine).toContain(src);
      expect(r.state.players.p1.frontLine).not.toContain(base);
      expect(r.state.instances[src]!.raidUnder).toContain(base);
    }
  });

  it("with no target, adds the revealed card to hand instead", () => {
    const g = bare();
    const src = inst(g, "p1", "RAIDER");
    const before = g.players.p1.hand.length;
    const r = resolveTriggerEffect(g, "raid" as TriggerType, { seat: "p1", iid: src, activate: true });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.state.players.p1.hand).toContain(src);
      expect(r.state.players.p1.hand.length).toBe(before + 1);
    }
  });

  it("rejects raid when energy requirement is not met", () => {
    const g = bare();
    const base = inst(g, "p1", "BP1000"); // no energy generator on energy line
    g.players.p1.frontLine = [base];
    const src = inst(g, "p1", "RAIDER");
    const r = resolveTriggerEffect(g, "raid" as TriggerType, {
      seat: "p1",
      iid: src,
      activate: true,
      targetIid: base,
    });
    expect(r.ok).toBe(false);
  });
});

describe("declining a trigger", () => {
  it("just sidelines the source with no effect", () => {
    const g = bare();
    const t = inst(g, "p2", "BP1000");
    g.players.p2.frontLine = [t];
    const src = inst(g, "p1", "FILLER");
    const r = resolveTriggerEffect(g, "special" as TriggerType, { seat: "p1", iid: src, activate: false, targetIid: t });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.state.players.p2.frontLine).toContain(t); // not sidelined
      expect(r.state.players.p1.sideline).toContain(src);
    }
  });
});
