import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { coverageReport } from "./coverage.js";
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
    effectText: "Draw a card.",
    effectTiming: "When Played",
    triggerText: "",
    triggerType: "none",
    imageUrl: "",
    source: "unionarena-tcg.com",
    scrapedAt: "2026-06-02T00:00:00.000Z",
    ...overrides,
  };
}

describe("coverageReport", () => {
  it("counts canonical playable cards by actual set code", () => {
    const dir = mkdtempSync(join(tmpdir(), "ua-card-data-"));
    const dataset: CardSet = {
      setCode: "UE19BT",
      setName: "Mixed title scrape",
      scrapedAt: "2026-06-02T00:00:00.000Z",
      cards: [
        raw({ id: "UE19BT/SMD-1-001", cardNumber: "SMD-1-001", rarity: "C" }),
        raw({ id: "UE19BT/SMD-1-001", cardNumber: "SMD-1-001", rarity: "C" }),
        raw({ id: "UE19BT/SMD-1-002", cardNumber: "SMD-1-002", rarity: "R★" }),
        raw({ id: "UE19BT/SMD-1-AP01", cardNumber: "SMD-1-AP01", rarity: "", type: "ap" }),
        raw({
          id: "UEPR/SMD-AP01",
          cardNumber: "SMD-AP01",
          setCode: "UEPR",
          rarity: "",
          type: "ap",
        }),
      ],
    };
    writeFileSync(join(dir, "mixed.json"), JSON.stringify(dataset), "utf8");

    const report = coverageReport(dir);

    expect(report.sets.map((set) => set.productCode)).toEqual(["UE19BT/SMD", "UEPR/SMD"]);
    expect(report.sets[0]).toMatchObject({
      rawPrintings: 4,
      cards: 1,
      alternateArtPrintings: 1,
      apPrintings: 1,
      cardsWithMappedEffects: 1,
    });
    expect(report.sets[1]).toMatchObject({
      rawPrintings: 1,
      cards: 0,
      apPrintings: 1,
    });
  });
});
