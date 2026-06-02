import { describe, it, expect } from "vitest";
import { applyIntent } from "./engine.js";
import { createGame, __resetIidCounter } from "./setup.js";
import { effectiveBp, energyPool } from "./helpers.js";
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
reg(def({ id: "RESTER", bp: 500, apCost: 0, effectIds: ["rest_opponent_front_on_play"] }));
reg(def({ id: "BOUNCER", bp: 500, apCost: 0, effectIds: ["return_other_1_energy_or_self_to_hand_on_play"] }));
// activate: self +3000
reg(def({ id: "PUMP", bp: 1000, effectIds: ["buff_self_3000_eot"] }));
// on-block: +2000 if attacker <=3000
reg(def({ id: "GUARD", bp: 2000, effectIds: ["block_guard_2000"] }));
reg(def({ id: "DEAD_DRAW", bp: 500, effectIds: ["draw_card_on_sideline"] }));
reg(def({ id: "DEAD_FILTER", bp: 500, effectIds: ["draw_card_then_sideline_card_on_sideline"] }));
reg(def({ id: "AP_REFRESH", type: "event", apCost: 0, effectIds: ["refresh_up_to_2_ap_on_use"] }));
reg(def({ id: "DRAW_TWO", type: "event", apCost: 0, effectIds: ["draw_two_cards_on_use"] }));
reg(def({ id: "REMOVAL_3000", type: "event", apCost: 0, effectIds: ["sideline_opponent_front_3000_or_less_on_use"] }));
reg(def({ id: "SEARCH_5", type: "event", apCost: 0, effectIds: ["search_top_5_add_one_on_use"] }));
reg(def({ id: "ACTIVE_ENERGY", effectIds: ["energy_generation_if_active"] }));
reg(def({ id: "NEEDS_RED", requiredEnergy: [{ color: "red", amount: 1 }] }));
reg(def({ id: "TEMP_ENERGY", effectIds: ["energy_generation_eot_and_sideline_on_activate"] }));
reg(def({ id: "NULLIFY_IMPACT", effectIds: ["nullify_impact"] }));
reg(def({ id: "DOUBLE_BLOCK", bp: 3000, effectIds: ["double_block"] }));
reg(def({ id: "IMPACT_ATTACKER", bp: 4000, keywords: ["impact"], impactN: 1 }));
reg(def({ id: "DEBUFFER", effectIds: ["debuff_opponent_front_1000_eot_activate"] }));
reg(def({ id: "BIGGER", bp: 3000 }));
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

  it("rests a default opponent front-line target", () => {
    const g = game();
    const target = place(g, "p2", "frontLine", "PLAIN");
    const rester = place(g, "p1", "hand", "RESTER");
    const s = must(applyIntent(g, { type: "playCard", seat: "p1", iid: rester, to: "frontLine" }));
    expect(s.instances[target]!.orientation).toBe("resting");
  });

  it("returns another low-energy character to hand, falling back to a legal default target", () => {
    const g = game();
    const target = place(g, "p1", "frontLine", "PLAIN");
    const bouncer = place(g, "p1", "hand", "BOUNCER");
    const s = must(applyIntent(g, { type: "playCard", seat: "p1", iid: bouncer, to: "frontLine" }));
    expect(s.players.p1.frontLine).toContain(bouncer);
    expect(s.players.p1.frontLine).not.toContain(target);
    expect(s.players.p1.hand).toContain(target);
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

  it("grants temporary energy generation, then sidelines itself at end of main phase", () => {
    const g = game();
    const source = place(g, "p1", "energyLine", "TEMP_ENERGY");
    expect(energyPool(g, "p1").red).toBe(0);

    const s1 = must(applyIntent(g, {
      type: "activateAbility",
      seat: "p1",
      iid: source,
      effectId: "energy_generation_eot_and_sideline_on_activate",
    }));
    expect(energyPool(s1, "p1").red).toBe(1);
    expect(s1.instances[source]!.sidelineAtEndOfMain).toBe(true);
    expect(s1.instances[source]!.orientation).toBe("resting");

    const s2 = must(applyIntent(s1, { type: "advancePhase", seat: "p1" }));
    expect(s2.phase).toBe("attack");
    expect(s2.players.p1.energyLine).not.toContain(source);
    expect(s2.players.p1.sideline).toContain(source);
  });

  it("sidelines an end-of-main character when ending the turn directly from main phase", () => {
    const g = game();
    const source = place(g, "p1", "energyLine", "TEMP_ENERGY");

    const s1 = must(applyIntent(g, {
      type: "activateAbility",
      seat: "p1",
      iid: source,
      effectId: "energy_generation_eot_and_sideline_on_activate",
    }));
    expect(s1.instances[source]!.sidelineAtEndOfMain).toBe(true);

    // End the turn directly from main phase (without stepping into attack).
    const s2 = must(applyIntent(s1, { type: "endTurn", seat: "p1" }));
    expect(s2.players.p1.energyLine).not.toContain(source);
    expect(s2.players.p1.sideline).toContain(source);
  });

  it("recognizes temporary energy generation from text when effect ids are stale", () => {
    reg(def({
      id: "TEMP_ENERGY_TEXT_ONLY",
      effectIds: [],
      energyGeneration: [{ color: "red", amount: 1 }],
      text: 'This character gains energy generation and "At the end of the main phase, sideline this character" until the end of the turn.',
    }));
    const g = game();
    const source = place(g, "p1", "energyLine", "TEMP_ENERGY_TEXT_ONLY");
    expect(energyPool(g, "p1").red).toBe(1);

    const s = must(applyIntent(g, {
      type: "activateAbility",
      seat: "p1",
      iid: source,
      effectId: "energy_generation_eot_and_sideline_on_activate",
    }));

    expect(energyPool(s, "p1").red).toBe(2);
    expect(s.instances[source]!.sidelineAtEndOfMain).toBe(true);
    expect(s.instances[source]!.orientation).toBe("resting");
  });

  it("rejects temporary energy generation when the source is already resting", () => {
    const g = game();
    const source = place(g, "p1", "energyLine", "TEMP_ENERGY");
    g.instances[source] = { ...g.instances[source]!, orientation: "resting" };

    const r = applyIntent(g, {
      type: "activateAbility",
      seat: "p1",
      iid: source,
      effectId: "energy_generation_eot_and_sideline_on_activate",
    });
    expect(r.ok).toBe(false);
  });

  it("debuffs an opponent front-line character until end of turn", () => {
    const g = game();
    const source = place(g, "p1", "frontLine", "DEBUFFER");
    const target = place(g, "p2", "frontLine", "BIGGER");

    const s = must(applyIntent(g, {
      type: "activateAbility",
      seat: "p1",
      iid: source,
      effectId: "debuff_opponent_front_1000_eot_activate",
    }));
    expect(effectiveBp(s, target)).toBe(2000);
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

  it("Double Block switches the blocker back to active after blocking", () => {
    const g = game();
    g.phase = "attack";
    g.activeSeat = "p1";
    const attacker = place(g, "p1", "frontLine", "PLAIN");
    const blocker = place(g, "p2", "frontLine", "DOUBLE_BLOCK");

    const s1 = must(applyIntent(g, { type: "declareAttack", seat: "p1", attackerIid: attacker }));
    const s2 = must(applyIntent(s1, { type: "declareBlock", seat: "p2", blockerIid: blocker }));

    expect(s2.players.p2.frontLine).toContain(blocker);
    expect(s2.instances[blocker]!.orientation).toBe("active");
  });

  it("nullifies Impact during a blocked battle", () => {
    const g = game();
    g.phase = "attack";
    g.activeSeat = "p1";
    const attacker = place(g, "p1", "frontLine", "IMPACT_ATTACKER");
    const blocker = place(g, "p2", "frontLine", "NULLIFY_IMPACT");
    const lifeBefore = g.players.p2.life.length;

    const s1 = must(applyIntent(g, { type: "declareAttack", seat: "p1", attackerIid: attacker }));
    const s2 = must(applyIntent(s1, { type: "declareBlock", seat: "p2", blockerIid: blocker }));

    expect(s2.players.p2.life.length).toBe(lifeBefore);
    expect(s2.pendingTriggers).toBeUndefined();
    expect(s2.log.some((event) => event.kind === "damage")).toBe(false);
  });
});

describe("static ability", () => {
  it("generates one energy while active on the energy line", () => {
    const g = game();
    const source = place(g, "p1", "energyLine", "ACTIVE_ENERGY");
    expect(energyPool(g, "p1").red).toBe(1);

    const playable = place(g, "p1", "hand", "NEEDS_RED");
    const s = must(applyIntent(g, { type: "playCard", seat: "p1", iid: playable, to: "frontLine" }));
    expect(s.players.p1.frontLine).toContain(playable);

    const resting = { ...g, instances: { ...g.instances, [source]: { ...g.instances[source]!, orientation: "resting" as const } } };
    expect(energyPool(resting, "p1").red).toBe(0);
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

  it("draws two cards", () => {
    const g = game();
    const event = place(g, "p1", "hand", "DRAW_TWO");
    const handBefore = g.players.p1.hand.length;
    const deckBefore = g.players.p1.deck.length;
    const s = must(applyIntent(g, { type: "useEvent", seat: "p1", iid: event }));
    expect(s.players.p1.hand.length).toBe(handBefore + 1);
    expect(s.players.p1.deck.length).toBe(deckBefore - 2);
    expect(s.players.p1.sideline).toContain(event);
  });

  it("sidelines a default opponent character with 3000 or less BP", () => {
    const g = game();
    const target = place(g, "p2", "frontLine", "PLAIN");
    const event = place(g, "p1", "hand", "REMOVAL_3000");
    const s = must(applyIntent(g, { type: "useEvent", seat: "p1", iid: event }));
    expect(s.players.p2.frontLine).not.toContain(target);
    expect(s.players.p2.sideline).toContain(target);
  });

  it("searches top five by adding one card to hand and bottoming the rest", () => {
    const g = game();
    const event = place(g, "p1", "hand", "SEARCH_5");
    const top = g.players.p1.deck[0]!;
    const second = g.players.p1.deck[1]!;
    const s = must(applyIntent(g, { type: "useEvent", seat: "p1", iid: event }));
    expect(s.players.p1.hand).toContain(top);
    expect(s.players.p1.deck).not.toContain(top);
    expect(s.players.p1.deck.slice(-4)).toContain(second);
  });
});
