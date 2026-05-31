// Map a normalized RawCard (dataset shape) to the engine's CardDef.
// Effects are left as ids/text for now; the effect registry (future) resolves them.
import type { CardDef, Keyword, TriggerType } from "@union-arena/core";
import type { RawCard } from "./schema.js";

const KEYWORD_PATTERNS: { kw: Keyword; re: RegExp }[] = [
  { kw: "step", re: /\bstep\b/i },
  { kw: "snipe", re: /\bsnipe\b/i },
  { kw: "impact", re: /\bimpact\b/i },
  { kw: "raid", re: /\braid\b/i },
];

/** Detect keyword abilities from the card's effect text. */
function detectKeywords(text: string): Keyword[] {
  const found: Keyword[] = [];
  for (const { kw, re } of KEYWORD_PATTERNS) {
    if (re.test(text)) found.push(kw);
  }
  return found;
}

/**
 * Infer engine effect ids from official card text. These must match ids in the
 * core effect registry (packages/core/src/effects.ts). Patterns are deliberately
 * specific; unmatched text just yields no effect id (falls back to display text).
 */
const EFFECT_PATTERNS: { id: string; re: RegExp }[] = [
  // "Choose up to one other character on your field. It gains 3000 BP until ... turn."
  {
    id: "buff_other_3000_eot",
    re: /choose up to one other character on your field[^.]*\.\s*it gains 3000 bp until the end of the turn/i,
  },
  // "This character gains 3000 BP until the end of the turn."
  {
    id: "buff_self_3000_eot",
    re: /this character gains 3000 bp until the end of the turn/i,
  },
  // "... if your opponent's attacking character has 3000 or less base BP, this character gains 2000 BP ..."
  {
    id: "block_guard_2000",
    re: /3000 or less base bp[^.]*gains 2000 bp/i,
  },
];

/** Detect known effect ids from the card's combined text. */
function detectEffectIds(text: string): string[] {
  const ids: string[] = [];
  for (const { id, re } of EFFECT_PATTERNS) {
    if (re.test(text) && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/** Detect "Impact N" -> N (pierce + N damage). Plain Impact -> 1. */
function detectImpactN(text: string): number | undefined {
  if (!/\bimpact\b/i.test(text)) return undefined;
  const m = text.match(/\bimpact\s*([0-9]+)/i);
  return m ? Number(m[1]) : 1;
}

export function toCardDef(raw: RawCard): CardDef {
  const allText = `${raw.effectText}\n${raw.triggerText}`;
  const keywords = detectKeywords(allText);
  const impactN = detectImpactN(allText);
  const effectIds = detectEffectIds(allText);
  const hasTrigger = raw.triggerType !== "none" && raw.triggerText.trim().length > 0;

  // RawCard.type may be "ap"; engine CardType is character|site|event. Map ap -> site-like support.
  const type: CardDef["type"] =
    raw.type === "ap" ? "site" : raw.type === "site" ? "site" : raw.type === "event" ? "event" : "character";

  const triggerType: TriggerType | undefined =
    hasTrigger && raw.triggerType !== "none" ? (raw.triggerType as TriggerType) : undefined;

  return {
    id: raw.id,
    cardNumber: raw.cardNumber,
    sourceCode: raw.sourceCode,
    name: raw.name,
    type,
    color: raw.color ?? "red",
    requiredEnergy: raw.requiredEnergy,
    apCost: raw.apCost,
    ...(raw.bp != null ? { bp: raw.bp } : {}),
    ...(impactN != null ? { impactN } : {}),
    energyGeneration: raw.generatedEnergy,
    affinities: raw.affinities,
    keywords,
    hasTrigger,
    ...(triggerType ? { triggerType } : {}),
    effectIds, // inferred from card text; resolved by the core effect registry
    text: [raw.effectText, raw.triggerText].filter(Boolean).join("\n").trim(),
    ...(raw.imageUrl ? { imageUrl: raw.imageUrl } : {}),
  };
}
