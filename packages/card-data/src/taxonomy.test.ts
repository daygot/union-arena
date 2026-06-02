import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { taxonomyReport } from "./taxonomy.js";
import type { CardSet, RawCard } from "./schema.js";

function raw(overrides: Partial<RawCard>): RawCard {
  return {
    id: "UE19BT/SMD-1-001",
    cardNumber: "SMD-1-001",
    sourceCode: "SMD",
    setCode: "UE19BT",
    setName: "SAKAMOTO DAYS",
    name: "Obiguro",
    rarity: "C",
    type: "character",
    color: "yellow",
    requiredEnergy: [],
    apCost: 1,
    bp: 500,
    generatedEnergy: [{ color: "yellow", amount: 1 }],
    affinities: [],
    effectText: "",
    effectTiming: "",
    triggerText: "",
    triggerType: "none",
    imageUrl: "",
    source: "unionarena-tcg.com",
    scrapedAt: "2026-06-02T00:00:00.000Z",
    ...overrides,
  };
}

function writeSet(cards: RawCard[]): string {
  const dir = mkdtempSync(join(tmpdir(), "ua-card-taxonomy-"));
  const dataset: CardSet = {
    setCode: "UE19BT",
    setName: "SAKAMOTO DAYS",
    cards,
    scrapedAt: "2026-06-02T00:00:00.000Z",
  };
  writeFileSync(join(dir, "UE19BT_SMD.json"), JSON.stringify(dataset), "utf8");
  return dir;
}

describe("taxonomyReport", () => {
  it("groups canonical cards into action buckets and unmapped signatures", () => {
    const dir = writeSet([
      raw({
        id: "UE19BT/SMD-1-001",
        cardNumber: "SMD-1-001",
        effectTiming: "When Played",
        effectText: "Draw a card.",
      }),
      raw({
        id: "UE19BT/SMD-1-002",
        cardNumber: "SMD-1-002",
        effectTiming: "When Played",
        effectText: "Choose up to one character on your opponent's front line. It loses 1000 BP until the end of the turn.",
      }),
      raw({
        id: "UE19BT/SMD-1-004",
        cardNumber: "SMD-1-004",
        effectTiming: "When Played",
        effectText: "This card does something the mapper does not recognize yet.",
      }),
      raw({
        id: "UE19BT/SMD-1-003",
        cardNumber: "SMD-1-003",
        rarity: "R★",
        effectText: "Draw a card.",
      }),
      raw({
        id: "UE19BT/SMD-1-AP01",
        cardNumber: "SMD-1-AP01",
        name: "Action Point Card(SAKAMOTO DAYS)",
        type: "ap",
        color: null,
      }),
    ]);

    const report = taxonomyReport(dir);

    expect(report.cards).toBe(3);
    expect(report.cardsWithText).toBe(3);
    expect(report.mappedCards).toBe(2);
    expect(report.unmappedCards).toBe(1);
    expect(report.buckets.find((bucket) => bucket.id === "draw_filter")).toMatchObject({ cards: 1, mappedCards: 1 });
    expect(report.buckets.find((bucket) => bucket.id === "bp_debuff")).toMatchObject({ cards: 1, mappedCards: 1 });
    expect(report.topUnmappedSignatures[0]?.signature).toContain("does something");
  });
});
