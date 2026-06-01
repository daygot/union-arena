import { describe, it, expect } from "vitest";
import { applyIntent } from "./engine.js";
import { createGame, __resetIidCounter } from "./setup.js";
import { effectiveBp } from "./helpers.js";
import type { ApplyResult, CardDef, GameState, Seat } from "./types.js";

function def(partial: Partial<CardDef> & { id: string }): CardDef {
  return {
    cardNumber: partial.id,
    sourceCode: "TST",
    name: partial.id,
    type: "character",
    color: "red",
    requiredEnergy: [],
    apCost: 0,
    bp: 1000,
    energyGeneration: [],
    affinities: [],
    keywords: [],
    hasTrigger: false,
    effectIds: [],
    text: "",
    ...partial,
  };
}

const DEFS: Record<string, CardDef> = {};
const reg = (d: CardDef) => (DEFS[d.id] = d);
// Energy generator so plays that need 1 red succeed.
reg(def({ id: "GEN", energyGeneration: [{ color: "red", amount: 1 }] }));
reg(def({ id: "PLAIN", bp: 1000 }));
// on-play: buff up to one other field char by 3000
reg(def({ id: "BUFFER", bp: 500, apCost: 0, effectIds: ["buff_other_3000_eot"] }));
reg(def({ id: "PLAY_FILTER", bp: 500, apCost: 0, effectIds: ["draw_card_then_sideline_card_on_play"] }));
// activate: self +3000
reg(def({ id: "PUMP", bp: 1000, effectIds: ["buff_self_3000_eot"] }));
// on-block: +2000 if attacker <=3000
reg(def({ id: "GUARD", bp: 2000, effectIds: ["block_guard_2000"] }));
reg(def({ id: "DEAD_DRAW", bp: 500, effectIds: ["draw_card_on_sideline"] }));
reg(def({ id: "DEAD_FILTER", bp: 500, effectIds: ["draw_card_then_sideline_card_on_sideline"] }));
reg(def({ id: "AP_REFRESH", type: "event", apCost: 0, effectIds: ["refresh_up_to_2_ap_on_use"] }));
reg(def({ id: "AP", type: "site", name: "AP", apCost: 0 }));

function must(r: ApplyResult): GameState {
  if (!r.ok) throw new Error(`Intent failed: ${r.error}`);
  return r.state;
}

function game(): GameState {
  __resetIidCounter();
  const filler = Array.from({ length: 50 }, () => "PLAIN");
  const g = createGame({
    seed: 1,
    defs: DEFS,
    decks: { p1: { cards: filler, apCardId: "AP" }, p2: { cards: filler, apCardId: "AP" } },
  });
  for (const seat of ["p1", "p2"] as Seat[]) {
    g.players[seat].frontLine = [];
    g.players[seat].energyLine = [];
    g.players[seat].hand = [];
  }
  g.activeSeat = "p1";
  g.phase = "main";
  g.turn = 2;
  return g;
}

let mint = 200000;
function place(g: GameState, seat: Seat, zone: "frontLine" | "energyLine" | "hand", defId: string): string {
  const iid = `${seat}-${zone}-${mint++}`;
  g.instances[iid] = {
    iid, defId, owner: seat, controller: seat, orientation: "active", raidUnder: [], faceUp: false,
  };
  g.players[seat][zone] = [...g.players[seat][zone], iid];
  return iid;
}

describe("on-play ability", () => {
  it("buffs a chosen other field character by 3000 BP", () => {
    const g = game();
    const target = place(g, "p1", "frontLine", "PLAIN"); // BP 1000
    const buffer = place(g, "p1", "hand", "BUFFER");
    const s = must(applyIntent(g, { type: "playCard", seat: "p1", iid: buffer, to: "frontLine", targetIid: target }));
    expect(effectiveBp(s, target)).toBe(4000);
  });

  it("is optional: playing with no target just resolves (fizzle)", () => {
    const g = game();
    const buffer = place(g, "p1", "hand", "BUFFER");
    const s = must(applyIntent(g, { type: "playCard", seat: "p1", iid: buffer, to: "frontLine" }));
    // buffer landed; no crash
    expect(s.players.p1.frontLine).toContain(buffer);
  });

  it("rejects targeting itself", () => {
    const g = game();
    const buffer = place(g, "p1", "hand", "BUFFER");
    const r = applyIntent(g, { type: "playCard", seat: "p1", iid: buffer, to: "frontLine", targetIid: buffer });
    expect(r.ok).toBe(false);
  });

  it("rejects targeting a non-field card", () => {
    const g = game();
    const buffer = place(g, "p1", "hand", "BUFFER");
    const r = applyIntent(g, { type: "playCard", seat: "p1", iid: buffer, to: "frontLine", targetIid: "p2-frontLine-999" });
    expect(r.ok).toBe(false);
  });

  it("draws then sidelines one card from hand", () => {
    const g = game();
    const filter = place(g, "p1", "hand", "PLAY_FILTER");
    const handBefore = g.players.p1.hand.length;
    const sidelineBefore = g.players.p1.sideline.length;
    const s = must(applyIntent(g, { type: "playCard", seat: "p1", iid: filter, to: "frontLine" }));
    expect(s.players.p1.frontLine).toContain(filter);
    expect(s.players.p1.hand.length).toBe(handBefore - 1);
    expect(s.players.p1.sideline.length).toBe(sidelineBefore + 1);
  });
});

describe("activate ability", () => {
  it("self-buffs +3000 when activated", () => {
    const g = game();
    const pump = place(g, "p1", "frontLine", "PUMP");
    const s = must(applyIntent(g, { type: "activateAbility", seat: "p1", iid: pump, effectId: "buff_self_3000_eot" }));
    expect(effectiveBp(s, pump)).toBe(4000);
  });

  it("rejects activating an unknown ability", () => {
    const g = game();
    const pump = place(g, "p1", "frontLine", "PUMP");
    const r = applyIntent(g, { type: "activateAbility", seat: "p1", iid: pump, effectId: "nope" });
    expect(r.ok).toBe(false);
  });

  it("rejects activating from a player who doesn't control it", () => {
    const g = game();
    const pump = place(g, "p1", "frontLine", "PUMP");
    const r = applyIntent(g, { type: "activateAbility", seat: "p2", iid: pump, effectId: "buff_self_3000_eot" });
    expect(r.ok).toBe(false);
  });
});

describe("on-block ability", () => {
  it("gains 2000 BP when blocking an attacker with <=3000 BP", () => {
    const g = game();
    g.phase = "attack";
    g.activeSeat = "p1";
    const attacker = place(g, "p1", "frontLine", "PLAIN"); // BP 1000 (<=3000)
    const guard = place(g, "p2", "frontLine", "GUARD"); // BP 2000 -> +2000 = 4000
    const s1 = must(applyIntent(g, { type: "declareAttack", seat: "p1", attackerIid: attacker }));
    const s2 = must(applyIntent(s1, { type: "declareBlock", seat: "p2", blockerIid: guard }));
    // guard (2000+2000=4000) beats attacker (1000) -> attacker survives, guard survives, attacker not sidelined
    expect(s2.players.p2.frontLine).toContain(guard);
  });
});

describe("on-sideline ability", () => {
  it("draws a card when sidelined in battle", () => {
    const g = game();
    g.phase = "attack";
    g.activeSeat = "p1";
    const attacker = place(g, "p1", "frontLine", "PLAIN");
    const defender = place(g, "p2", "frontLine", "DEAD_DRAW");
    const handBefore = g.players.p2.hand.length;
    const deckBefore = g.players.p2.deck.length;
    const s1 = must(applyIntent(g, { type: "declareAttack", seat: "p1", attackerIid: attacker }));
    const s2 = must(applyIntent(s1, { type: "declareBlock", seat: "p2", blockerIid: defender }));
    expect(s2.players.p2.sideline).toContain(defender);
    expect(s2.players.p2.hand.length).toBe(handBefore + 1);
    expect(s2.players.p2.deck.length).toBe(deckBefore - 1);
  });

  it("draws then sidelines one card from hand", () => {
    const g = game();
    g.phase = "attack";
    g.activeSeat = "p1";
    const attacker = place(g, "p1", "frontLine", "PLAIN");
    const defender = place(g, "p2", "frontLine", "DEAD_FILTER");
    const sidelineBefore = g.players.p2.sideline.length;
    const handBefore = g.players.p2.hand.length;
    const s1 = must(applyIntent(g, { type: "declareAttack", seat: "p1", attackerIid: attacker }));
    const s2 = must(applyIntent(s1, { type: "declareBlock", seat: "p2", blockerIid: defender }));
    expect(s2.players.p2.sideline.length).toBe(sidelineBefore + 2);
    expect(s2.players.p2.hand.length).toBe(handBefore);
  });
});

describe("on-use event ability", () => {
  it("refreshes up to two resting AP", () => {
    const g = game();
    const event = place(g, "p1", "hand", "AP_REFRESH");
    for (const iid of g.players.p1.ap.slice(0, 2)) {
      g.instances[iid] = { ...g.instances[iid]!, orientation: "resting" };
    }
    const s = must(applyIntent(g, { type: "useEvent", seat: "p1", iid: event }));
    const active = s.players.p1.ap.filter((iid) => s.instances[iid]!.orientation === "active").length;
    expect(active).toBe(3);
    expect(s.players.p1.sideline).toContain(event);
  });
});
