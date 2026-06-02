import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { EFFECTS, type CardDef } from "@union-arena/core";
import { toCardDef } from "./mapper.js";
import { CardSetSchema, RawCardSchema, type RawCard } from "./schema.js";
import { canonicalPlayableCards, isAlternateArt, isApCard, productGroupKey } from "./normalize.js";

export interface CoverageSetSummary {
  productCode: string;
  setCode: string;
  sourceCode: string;
  setName: string;
  rawPrintings: number;
  apPrintings: number;
  alternateArtPrintings: number;
  cards: number;
  cardsWithText: number;
  cardsWithMappedEffects: number;
  mappedEffectIds: Record<string, number>;
  triggerTypes: Record<string, number>;
  unknownEffectIds: Record<string, number>;
}

export interface CoverageReport {
  sets: CoverageSetSummary[];
  totals: Omit<CoverageSetSummary, "productCode" | "setCode" | "sourceCode" | "setName">;
}

function bump(map: Record<string, number>, key: string): void {
  map[key] = (map[key] ?? 0) + 1;
}

function emptySummary(productCode: string, setCode: string, sourceCode: string, setName: string): CoverageSetSummary {
  return {
    productCode,
    setCode,
    sourceCode,
    setName,
    rawPrintings: 0,
    apPrintings: 0,
    alternateArtPrintings: 0,
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
  totals.rawPrintings += set.rawPrintings;
  totals.apPrintings += set.apPrintings;
  totals.alternateArtPrintings += set.alternateArtPrintings;
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

  const rawBySet = new Map<string, { setCode: string; sourceCode: string; setName: string; cards: RawCard[] }>();

  for (const file of files) {
    const parsed = CardSetSchema.parse(JSON.parse(readFileSync(resolve(setsDir, file), "utf8")));
    for (const rawJson of parsed.cards) {
      const raw = RawCardSchema.parse(rawJson);
      const key = productGroupKey(raw);
      const current = rawBySet.get(key) ?? {
        setCode: raw.setCode,
        sourceCode: raw.sourceCode,
        setName: raw.setName || parsed.setName,
        cards: [],
      };
      current.cards.push(raw);
      if (!current.setName && raw.setName) current.setName = raw.setName;
      rawBySet.set(key, current);
    }
  }

  const sets: CoverageSetSummary[] = [];
  const totals = emptySummary("ALL", "ALL", "ALL", "All sets");

  for (const [productCode, group] of [...rawBySet.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const summary = emptySummary(productCode, group.setCode, group.sourceCode, group.setName);
    summary.rawPrintings = group.cards.length;
    for (const raw of group.cards) {
      if (isApCard(raw)) summary.apPrintings++;
      if (isAlternateArt(raw)) summary.alternateArtPrintings++;
    }
    for (const raw of canonicalPlayableCards(group.cards)) {
      addCard(summary, toCardDef(raw));
    }
    mergeIntoTotals(totals, summary);
    sets.push(summary);
  }

  return {
    sets,
    totals: {
      rawPrintings: totals.rawPrintings,
      apPrintings: totals.apPrintings,
      alternateArtPrintings: totals.alternateArtPrintings,
      cards: totals.cards,
      cardsWithText: totals.cardsWithText,
      cardsWithMappedEffects: totals.cardsWithMappedEffects,
      mappedEffectIds: totals.mappedEffectIds,
      triggerTypes: totals.triggerTypes,
      unknownEffectIds: totals.unknownEffectIds,
    },
  };
}
