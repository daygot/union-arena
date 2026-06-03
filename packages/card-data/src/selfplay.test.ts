import { describe, expect, it } from "vitest";
import type { CardDef, GameState } from "@union-arena/core";
import { validateSelfPlayInvariants } from "./selfplay.js";

function def(id: string): CardDef {
  return {
    id,
    cardNumber: id,
    sourceCode: "TST",
    name: id,
    type: "character",
    color: "red",
    requiredEnergy: [],
    apCost: 0,
    bp: 1000,
    energyGeneration: [{ color: "red", amount: 1 }],
    affinities: [],
    keywords: [],
    hasTrigger: false,
    effectIds: [],
    text: "",
  };
}

function state(): GameState {
  const card = def("C1");
  return {
    rngState: 1,
    turn: 1,
    activeSeat: "p1",
    phase: "main",
    defs: { C1: card },
    instances: {
      i1: {
        iid: "i1",
        defId: "C1",
        owner: "p1",
        controller: "p1",
        orientation: "active",
        raidUnder: [],
        faceUp: false,
      },
    },
    players: {
      p1: {
        seat: "p1",
        deck: [],
        hand: ["i1"],
        frontLine: [],
        energyLine: [],
        life: [],
        ap: [],
        sideline: [],
        removal: [],
        hasMulliganed: true,
        extraDrawUsedThisTurn: false,
      },
      p2: {
        seat: "p2",
        deck: [],
        hand: [],
        frontLine: [],
        energyLine: [],
        life: [],
        ap: [],
        sideline: [],
        removal: [],
        hasMulliganed: true,
        extraDrawUsedThisTurn: false,
      },
    },
    log: [],
  };
}

describe("validateSelfPlayInvariants", () => {
  it("accepts a simple accounted-for state", () => {
    expect(validateSelfPlayInvariants(state())).toEqual([]);
  });

  it("reports duplicate instance locations", () => {
    const s = state();
    s.players.p1.frontLine = ["i1"];

    expect(validateSelfPlayInvariants(s)).toContain("i1 appears in p1.hand, p1.frontLine.");
  });

  it("allows cards under a Raid stack to be absent from normal zones", () => {
    const s = state();
    s.defs.C2 = def("C2");
    s.instances.i2 = {
      iid: "i2",
      defId: "C2",
      owner: "p1",
      controller: "p1",
      orientation: "active",
      raidUnder: ["i1"],
      faceUp: false,
    };
    s.players.p1.hand = [];
    s.players.p1.frontLine = ["i2"];

    expect(validateSelfPlayInvariants(s)).toEqual([]);
  });
});

