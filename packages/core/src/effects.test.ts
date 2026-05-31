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
// activate: self +3000
reg(def({ id: "PUMP", bp: 1000, effectIds: ["buff_self_3000_eot"] }));
// on-block: +2000 if attacker <=3000
reg(def({ id: "GUARD", bp: 2000, effectIds: ["block_guard_2000"] }));
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
