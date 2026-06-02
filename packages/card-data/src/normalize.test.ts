import { describe, expect, it } from "vitest";
import { canonicalPlayableCards, groupCardsByProduct, isAlternateArt, isApCard } from "./normalize.js";
import type { RawCard } from "./schema.js";

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

describe("card normalization", () => {
  it("detects AP cards by parsed type, card number, or name", () => {
    expect(isApCard(raw({ type: "ap" }))).toBe(true);
    expect(isApCard(raw({ cardNumber: "SMD-1-AP01" }))).toBe(true);
    expect(isApCard(raw({ name: "Action Point Card(SAKAMOTO DAYS)" }))).toBe(true);
  });

  it("detects star-rarity alternate art printings", () => {
    expect(isAlternateArt(raw({ rarity: "SR★★" }))).toBe(true);
    expect(isAlternateArt(raw({ rarity: "SR" }))).toBe(false);
  });

  it("keeps one base rules card per set/card number and skips AP/alternate arts", () => {
    const cards = [
      raw({ id: "UE19BT/SMD-1-001", cardNumber: "SMD-1-001", rarity: "C" }),
      raw({ id: "UE19BT/SMD-1-001", cardNumber: "SMD-1-001", rarity: "C" }),
      raw({ id: "UE19BT/SMD-1-002", cardNumber: "SMD-1-002", rarity: "R★" }),
      raw({ id: "UE19BT/SMD-1-AP01", cardNumber: "SMD-1-AP01", rarity: "", type: "ap" }),
      raw({ id: "UE19BT/SMD-1-003", cardNumber: "SMD-1-003", rarity: "U" }),
    ];

    expect(canonicalPlayableCards(cards).map((card) => card.cardNumber)).toEqual(["SMD-1-001", "SMD-1-003"]);
  });

  it("groups mixed title scrape output by actual product/source identity", () => {
    const groups = groupCardsByProduct([
      raw({ setCode: "UE19BT" }),
      raw({ id: "UEPR/SMD-AP01", cardNumber: "SMD-AP01", setCode: "UEPR" }),
      raw({ id: "UEPR/HTR-AP01", cardNumber: "HTR-AP01", sourceCode: "HTR", setCode: "UEPR" }),
    ]);

    expect(groups.get("UE19BT/SMD")).toHaveLength(1);
    expect(groups.get("UEPR/SMD")).toHaveLength(1);
    expect(groups.get("UEPR/HTR")).toHaveLength(1);
  });
});
