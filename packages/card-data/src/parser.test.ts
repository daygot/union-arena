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
});
