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
    effectIds: [], // resolved later by the effect registry
    text: [raw.effectText, raw.triggerText].filter(Boolean).join("\n").trim(),
    ...(raw.imageUrl ? { imageUrl: raw.imageUrl } : {}),
  };
}
