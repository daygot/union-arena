import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { EFFECTS, type CardDef } from "@union-arena/core";
import { toCardDef } from "./mapper.js";
import { CardSetSchema, RawCardSchema } from "./schema.js";

export interface CoverageSetSummary {
  setCode: string;
  setName: string;
  cards: number;
  cardsWithText: number;
  cardsWithMappedEffects: number;
  mappedEffectIds: Record<string, number>;
  triggerTypes: Record<string, number>;
  unknownEffectIds: Record<string, number>;
}

export interface CoverageReport {
  sets: CoverageSetSummary[];
  totals: Omit<CoverageSetSummary, "setCode" | "setName">;
}

function bump(map: Record<string, number>, key: string): void {
  map[key] = (map[key] ?? 0) + 1;
}

function emptySummary(setCode: string, setName: string): CoverageSetSummary {
  return {
    setCode,
    setName,
    cards: 0,
    cardsWithText: 0,
    cardsWithMappedEffects: 0,
    mappedEffectIds: {},
    triggerTypes: {},
    unknownEffectIds: {},
  };
}

function addCard(summary: CoverageSetSummary, def: CardDef): void {
  summary.cards++;
  if (def.text.trim()) summary.cardsWithText++;
  if (def.effectIds.length > 0) summary.cardsWithMappedEffects++;
  for (const id of def.effectIds) {
    if (EFFECTS[id]) bump(summary.mappedEffectIds, id);
    else bump(summary.unknownEffectIds, id);
  }
  if (def.triggerType) bump(summary.triggerTypes, def.triggerType);
}

function mergeIntoTotals(totals: CoverageReport["totals"], set: CoverageSetSummary): void {
  totals.cards += set.cards;
  totals.cardsWithText += set.cardsWithText;
  totals.cardsWithMappedEffects += set.cardsWithMappedEffects;
  for (const [id, count] of Object.entries(set.mappedEffectIds)) {
    totals.mappedEffectIds[id] = (totals.mappedEffectIds[id] ?? 0) + count;
  }
  for (const [id, count] of Object.entries(set.triggerTypes)) {
    totals.triggerTypes[id] = (totals.triggerTypes[id] ?? 0) + count;
  }
  for (const [id, count] of Object.entries(set.unknownEffectIds)) {
    totals.unknownEffectIds[id] = (totals.unknownEffectIds[id] ?? 0) + count;
  }
}

export function coverageReport(setsDir: string): CoverageReport {
  const files = readdirSync(setsDir)
    .filter((file) => file.endsWith(".json"))
    .sort();

  const sets: CoverageSetSummary[] = [];
  const totals = emptySummary("ALL", "All sets");

  for (const file of files) {
    const parsed = CardSetSchema.parse(JSON.parse(readFileSync(resolve(setsDir, file), "utf8")));
    const summary = emptySummary(parsed.setCode, parsed.setName);
    for (const rawJson of parsed.cards) {
      const raw = RawCardSchema.parse(rawJson);
      addCard(summary, toCardDef(raw));
    }
    mergeIntoTotals(totals, summary);
    sets.push(summary);
  }

  return {
    sets,
    totals: {
      cards: totals.cards,
      cardsWithText: totals.cardsWithText,
      cardsWithMappedEffects: totals.cardsWithMappedEffects,
      mappedEffectIds: totals.mappedEffectIds,
      triggerTypes: totals.triggerTypes,
      unknownEffectIds: totals.unknownEffectIds,
    },
  };
}
