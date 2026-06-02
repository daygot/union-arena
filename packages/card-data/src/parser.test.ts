import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCardListIndex, parseDetail, parseTitleOptions } from "./parser.js";
import { toCardDef } from "./mapper.js";
import { RawCardSchema } from "./schema.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fix = (f: string) => readFileSync(join(__dirname, "__fixtures__", f), "utf-8");

describe("parseCardListIndex", () => {
  it("extracts title options from the card list page", () => {
    const titles = parseTitleOptions(fix("list_sakamoto.html"));
    expect(titles.length).toBeGreaterThanOrEqual(20);
    expect(titles).toContainEqual({ id: "SAKAMOTO DAYS", name: "SAKAMOTO DAYS" });
  });

  it("extracts card entries from a title search result", () => {
    const entries = parseCardListIndex(fix("list_sakamoto.html"));
    expect(entries.length).toBeGreaterThan(100);
    const first = entries.find((e) => e.cardNo === "UE19BT/SMD-1-001");
    expect(first).toBeDefined();
    expect(first!.name).toBe("Obiguro");
    expect(first!.imagePath).toContain("SMD-1-001");
  });
});

describe("parseDetail", () => {
  const raw = parseDetail(fix("detail_smd-1-001.html"), {
    imageBaseUrl: "https://www.unionarena-tcg.com",
  });

  it("validates against the schema", () => {
    expect(() => RawCardSchema.parse(raw)).not.toThrow();
  });

  it("parses identity fields", () => {
    expect(raw.id).toBe("UE19BT/SMD-1-001");
    expect(raw.cardNumber).toBe("SMD-1-001");
    expect(raw.sourceCode).toBe("SMD");
    expect(raw.setCode).toBe("UE19BT");
    expect(raw.name).toBe("Obiguro");
    expect(raw.rarity).toBe("C");
  });

  it("parses stats", () => {
    expect(raw.type).toBe("character");
    expect(raw.bp).toBe(500);
    expect(raw.apCost).toBe(1);
  });

  it("classifies action point collectibles as AP cards", () => {
    const apHtml = fix("detail_smd-1-001.html")
      .replaceAll("UE19BT/SMD-1-001", "UE19BT/SMD-1-AP01")
      .replaceAll("Obiguro", "Action Point Card(SAKAMOTO DAYS)");
    const ap = parseDetail(apHtml, {
      imageBaseUrl: "https://www.unionarena-tcg.com",
    });

    expect(ap.type).toBe("ap");
  });

  it("parses generated energy with color + amount", () => {
    expect(raw.generatedEnergy).toEqual([{ color: "yellow", amount: 1 }]);
  });

  it("captures effect and trigger text", () => {
    expect(raw.effectText.toLowerCase()).toContain("3000 bp");
    expect(raw.effectTiming).toBe("When Sidelined");
    expect(raw.triggerText.toLowerCase()).toContain("switch it to active");
    // Trigger type comes from the official icon (alt="Active"), not text guessing.
    expect(raw.triggerType).toBe("active");
  });

  it("builds an absolute image url", () => {
    expect(raw.imageUrl).toMatch(/^https:\/\/www\.unionarena-tcg\.com\/.*SMD-1-001\.png/);
  });
});

describe("toCardDef mapping", () => {
  it("maps a RawCard to an engine CardDef", () => {
    const raw = parseDetail(fix("detail_smd-1-001.html"), {
      imageBaseUrl: "https://www.unionarena-tcg.com",
    });
    const def = toCardDef(raw);
    expect(def.id).toBe("UE19BT/SMD-1-001");
    expect(def.type).toBe("character");
    expect(def.bp).toBe(500);
    expect(def.color).toBe("yellow");
    expect(def.energyGeneration).toEqual([{ color: "yellow", amount: 1 }]);
    expect(def.hasTrigger).toBe(true);
    expect(def.effectIds).toContain("buff_other_3000_eot_on_sideline");
    expect(typeof def.text).toBe("string");
    expect(def.text.length).toBeGreaterThan(0);
  });

  it("maps common gameplay text to timed effect ids", () => {
    const base = parseDetail(fix("detail_smd-1-001.html"), {
      imageBaseUrl: "https://www.unionarena-tcg.com",
    });

    expect(
      toCardDef({
        ...base,
        type: "event",
        effectText: "Draw two cards. Your opponent reveals all the cards in their hand.",
        effectTiming: "",
      }).effectIds,
    ).toContain("draw_two_cards_on_use");

    expect(
      toCardDef({
        ...base,
        effectText: "Choose up to one character on your opponent's front line and switch it to resting. It will remain set to resting the next time it would be switched to active.",
        effectTiming: "When Played",
      }).effectIds,
    ).toContain("rest_opponent_front_on_play");

    expect(
      toCardDef({
        ...base,
        type: "event",
        effectText: "Choose one character with {3000 or less BP} on your opponent's front line and sideline it.",
        effectTiming: "",
      }).effectIds,
    ).toContain("sideline_opponent_front_3000_or_less_on_use");

    expect(
      toCardDef({
        ...base,
        type: "event",
        effectText: "Look at the top five cards of your deck. Reveal up to two [The Order] affinity cards and add them to your hand. Place the remaining cards on the bottom of your deck in any order.",
        effectTiming: "",
      }).effectIds,
    ).toContain("search_top_5_add_one_on_use");
  });

  it("maps rest-for-temporary-energy text variants comprehensively", () => {
    const base = parseDetail(fix("detail_smd-1-001.html"), {
      imageBaseUrl: "https://www.unionarena-tcg.com",
    });
    const variants = [
      "This character gains energy generation until the end of the turn. At the end of the main phase, sideline this character.",
      "This character gains energy generation and \"At the end of the main phase, sideline this character\" until the end of the turn.",
      "This card is also treated as <Muzan Kibutsuji>. This character gains energy generation until the end of the turn. At the end of the main phase, sideline this character.",
    ];

    for (const effectText of variants) {
      expect(
        toCardDef({
          ...base,
          effectText,
          effectTiming: "Activate: Main",
        }).effectIds,
      ).toContain("energy_generation_eot_and_sideline_on_activate");
    }
  });
});
