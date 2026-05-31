import { describe, it, expect } from "vitest";
import { validateDeck } from "./deck.js";
import type { CardDef, TriggerType } from "./types.js";

function def(partial: Partial<CardDef> & { id: string }): CardDef {
  return {
    cardNumber: partial.id,
    sourceCode: partial.id.slice(0, 3),
    name: partial.id,
    type: "character",
    color: "red",
    requiredEnergy: [],
    apCost: 1,
    energyGeneration: [],
    affinities: [],
    keywords: [],
    hasTrigger: false,
    effectIds: [],
    text: "",
    ...partial,
  };
}

function buildDefs(entries: CardDef[]): Record<string, CardDef> {
  const m: Record<string, CardDef> = {};
  for (const d of entries) m[d.id] = d;
  return m;
}

// A clean 50-card Bleach deck: 13 numbers (12x4 + 1x2).
function cleanBleach(): { ids: string[]; defs: Record<string, CardDef> } {
  const defsArr: CardDef[] = [];
  const ids: string[] = [];
  for (let n = 0; n < 13; n++) {
    const id = `BLC-1-${String(n).padStart(3, "0")}`;
    defsArr.push(def({ id }));
    const copies = n === 12 ? 2 : 4;
    for (let c = 0; c < copies; c++) ids.push(id);
  }
  return { ids, defs: buildDefs(defsArr) };
}

describe("validateDeck", () => {
  it("accepts a legal 50-card single-franchise deck", () => {
    const { ids, defs } = cleanBleach();
    expect(validateDeck(ids, defs)).toEqual({ ok: true, errors: [] });
  });

  it("rejects wrong card count", () => {
    const { ids, defs } = cleanBleach();
    const r = validateDeck(ids.slice(0, 49), defs);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("exactly 50"))).toBe(true);
  });

  it("rejects mixed franchises", () => {
    const { ids, defs } = cleanBleach();
    const cg = def({ id: "CGH-1-000" });
    const mixDefs = { ...defs, [cg.id]: cg };
    const mixIds = [...ids.slice(0, 49), cg.id];
    const r = validateDeck(mixIds, mixDefs);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("same franchise"))).toBe(true);
  });

  it("rejects more than 4 copies of a card number", () => {
    const { defs } = cleanBleach();
    const ids: string[] = [];
    // 5 copies of one number + 45 others
    for (let i = 0; i < 5; i++) ids.push("BLC-1-000");
    for (let n = 1; n <= 45; n++) ids.push(`BLC-1-000`); // force-many of same to trigger
    const r = validateDeck(ids, defs);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("Too many copies"))).toBe(true);
  });

  it("caps special/color/final triggers at 4 but not get/draw/active", () => {
    const mk = (id: string, tt: TriggerType) =>
      def({ id, sourceCode: "BLC", hasTrigger: true, triggerType: tt });
    const defsArr: CardDef[] = [];
    const ids: string[] = [];

    // 5 distinct "special" trigger cards -> should violate (5 > 4)
    for (let i = 0; i < 5; i++) {
      const id = `BLC-1-1${i}`;
      defsArr.push(mk(id, "special"));
      ids.push(id);
    }
    // 8 "draw" trigger cards across distinct numbers -> should be fine (uncapped)
    for (let i = 0; i < 8; i++) {
      const id = `BLC-1-2${i}`;
      defsArr.push(mk(id, "draw"));
      ids.push(id);
    }
    // pad to 50 with plain cards (<=4 each)
    let n = 0;
    while (ids.length < 50) {
      const id = `BLC-1-9${n}`;
      defsArr.push(def({ id, sourceCode: "BLC" }));
      const need = Math.min(4, 50 - ids.length);
      for (let c = 0; c < need; c++) ids.push(id);
      n++;
    }
    const defs = buildDefs(defsArr);
    const r = validateDeck(ids, defs);
    expect(r.errors.some((e) => e.includes('"special"'))).toBe(true);
    expect(r.errors.some((e) => e.includes('"draw"'))).toBe(false);
  });
});
