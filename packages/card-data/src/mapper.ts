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
  {
    id: "energy_generation_if_active",
    re: /^if this character is active, it gains energy generation\.?$/i,
  },
  {
    id: "energy_generation_eot_and_sideline_on_activate",
    re: /this character gains energy generation(?: and "at the end of the main phase, sideline this character")? until the end of the turn\. at the end of the main phase, sideline this character\.?/i,
  },
  {
    id: "energy_generation_eot_and_sideline_on_activate",
    re: /this character gains energy generation and "at the end of the main phase, sideline this character" until the end of the turn\.?/i,
  },
  {
    id: "nullify_impact",
    re: /^\(the character battling this character loses (?:impact )?for the duration of this battle\.\)$/i,
  },
  {
    id: "double_block",
    re: /^\(when this character blocks for the first time this turn, switch it to active\.\)/i,
  },
  // "Choose up to one other character on your field. It gains 3000 BP until ... turn."
  {
    id: "buff_other_3000_eot",
    re: /choose up to one other character on your field[^.]*\.\s*it gains 3000 bp until the end of the turn/i,
  },
  {
    id: "buff_other_1000_eot",
    re: /choose (?:up to )?one other character on your field[^.]*\.\s*it gains 1000 bp until the end of the turn/i,
  },
  {
    id: "buff_other_2000_eot",
    re: /choose up to one other character on your field[^.]*\.\s*it gains 2000 bp until the end of the turn/i,
  },
  // "This character gains 3000 BP until the end of the turn."
  {
    id: "buff_self_3000_eot",
    re: /this character gains 3000 bp until the end of the turn/i,
  },
  {
    id: "buff_self_1000_eot",
    re: /^this character gains 1000 bp until the end of the turn\.?$/i,
  },
  {
    id: "buff_self_2000_eot",
    re: /^this character gains 2000 bp until the end of the turn\.?$/i,
  },
  {
    id: "debuff_opponent_front_500_eot",
    re: /choose up to one character on your opponent's front line\.\s*it loses 500 bp until the end of the turn/i,
  },
  {
    id: "debuff_opponent_front_1000_eot",
    re: /choose (?:up to )?one character on your opponent's front line\.\s*it loses 1000 bp until the end of the turn/i,
  },
  {
    id: "debuff_opponent_front_2000_eot",
    re: /choose up to one character on your opponent's front line\.\s*it loses 2000 bp until the end of the turn/i,
  },
  {
    id: "debuff_opponent_front_3000_eot",
    re: /choose up to one character on your opponent's front line\.\s*it loses 3000 bp until the end of the turn/i,
  },
  // "... if your opponent's attacking character has 3000 or less base BP, this character gains 2000 BP ..."
  {
    id: "block_guard_2000",
    re: /3000 or less base bp[^.]*gains 2000 bp/i,
  },
  {
    id: "draw_card",
    re: /^draw a card\.?$/i,
  },
  {
    id: "draw_two_cards",
    re: /^draw two cards\./i,
  },
  {
    id: "draw_card_then_sideline_card",
    re: /^draw a card, then place one card from your hand into your sideline\.?$/i,
  },
  {
    id: "return_other_1_energy_or_self_to_hand",
    re: /^return one other character on your field with 1 or less required energy to your hand\. if you cannot, return this character to your hand\.?$/i,
  },
  {
    id: "rest_opponent_front",
    re: /choose up to one character on your opponent's front line and switch it to resting/i,
  },
  {
    id: "place_opponent_front_into_life",
    re: /^choose up to one character on your opponent's front line\. place it face up into their life area\.?$/i,
  },
  {
    id: "sideline_opponent_front_3000_or_less",
    re: /choose one character with (?:\{)?3000 or less bp(?:\})? on your opponent's front line and sideline it/i,
  },
  {
    id: "sideline_opponent_front_5000_or_less",
    re: /choose one character with (?:\{)?5000 or less bp(?:\})? on your opponent's front line and sideline it/i,
  },
  {
    id: "bounce_opponent_front_3000_or_less",
    re: /choose up to one character with 3000 or less bp on your opponent's front line and return it to their hand/i,
  },
  {
    id: "bounce_opponent_front_3500_or_less",
    re: /choose one character with 3500 or less bp on your opponent's front line and return it to their hand/i,
  },
  {
    id: "search_top_3_add_one_then_sideline_card",
    re: /^look at the top three cards of your deck\..*add it to your hand\..*if you added a card to your hand, place one card from your hand into your sideline\.?$/i,
  },
  {
    id: "search_top_4_add_one_then_sideline_card",
    re: /^look at the top four cards of your deck\..*add it to your hand\..*if you added a card to your hand, place one card from your hand into your sideline\.?$/i,
  },
  {
    id: "search_top_5_add_one",
    re: /^look at the top five cards of your deck\..*add (?:it|them) to your hand\..*place the remaining cards on the bottom of your deck/i,
  },
  {
    id: "search_top_7_add_one",
    re: /^look at the top seven cards of your deck\..*add it to your hand\..*place the remaining cards on the bottom of your deck/i,
  },
  {
    id: "refresh_up_to_2_ap",
    re: /^choose up to two of your ap cards and switch them to active\.?$/i,
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

function effectTimingSuffix(raw: RawCard): string {
  const timing = raw.effectTiming.toLowerCase();
  if (raw.type === "event") return "on_use";
  if (timing.includes("activate")) return "activate";
  if (timing.includes("sidelined")) return "on_sideline";
  if (timing.includes("attacking")) return "on_attack";
  if (timing.includes("blocking")) return "on_block";
  if (timing.includes("played")) return "on_play";
  if (timing.includes("raid")) return "on_play";
  return "";
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
  const suffix = effectTimingSuffix(raw);
  const directEffectIds = new Set([
    "block_guard_2000",
    "buff_other_1000_eot",
    "buff_other_2000_eot",
    "buff_self_1000_eot",
    "buff_self_2000_eot",
    "buff_self_3000_eot",
    "double_block",
    "energy_generation_eot_and_sideline_on_activate",
    "energy_generation_if_active",
    "nullify_impact",
  ]);
  const effectIds = detectEffectIds(raw.effectText).map((id) => {
    if (directEffectIds.has(id)) return id;
    if (id.includes("_on_")) return id;
    return suffix ? `${id}_${suffix}` : id;
  });
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
