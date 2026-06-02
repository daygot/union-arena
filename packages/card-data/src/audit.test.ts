import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { auditCardData } from "./audit.js";
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

function writeSet(cards: RawCard[]): string {
  const dir = mkdtempSync(join(tmpdir(), "ua-card-audit-"));
  const dataset: CardSet = {
    setCode: cards[0]?.setCode ?? "UE19BT",
    setName: cards[0]?.setName ?? "",
    cards,
    scrapedAt: "2026-06-02T00:00:00.000Z",
  };
  writeFileSync(join(dir, "UE19BT_SMD.json"), JSON.stringify(dataset), "utf8");
  return dir;
}

describe("auditCardData", () => {
  it("accepts a clean canonical card plus AP and alternate-art printings", () => {
    const dir = writeSet([
      raw({ id: "UE19BT/SMD-1-001", cardNumber: "SMD-1-001", rarity: "C" }),
      raw({ id: "UE19BT/SMD-1-001", cardNumber: "SMD-1-001", rarity: "C★" }),
      raw({
        id: "UE19BT/SMD-1-AP01",
        cardNumber: "SMD-1-AP01",
        name: "Action Point Card(SAKAMOTO DAYS)",
        rarity: "",
        type: "ap",
        color: null,
        bp: null,
      }),
    ]);

    const report = auditCardData(dir);

    expect(report.canonicalCards).toBe(1);
    expect(report.apPrintings).toBe(1);
    expect(report.alternateArtPrintings).toBe(1);
    expect(report.issues).toEqual([]);
  });

  it("warns but does not fail when stale generated data stores AP as character", () => {
    const dir = writeSet([
      raw({
        id: "UE19BT/SMD-1-AP01",
        cardNumber: "SMD-1-AP01",
        name: "Action Point Card(SAKAMOTO DAYS)",
        rarity: "",
        type: "character",
        color: null,
        bp: null,
      }),
    ]);

    const report = auditCardData(dir);

    expect(report.issues).toHaveLength(1);
    expect(report.issues[0]).toMatchObject({ level: "warning", code: "ap-type-mismatch" });
  });
});
