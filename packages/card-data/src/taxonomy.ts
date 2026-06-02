import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { toCardDef } from "./mapper.js";
import { canonicalPlayableCards } from "./normalize.js";
import { CardSetSchema, RawCardSchema, type RawCard } from "./schema.js";

export interface TaxonomyExample {
  id: string;
  name: string;
  timing: string;
  type: RawCard["type"];
  text: string;
  mappedEffectIds: string[];
}

export interface TaxonomyBucket {
  id: string;
  label: string;
  cards: number;
  mappedCards: number;
  unmappedCards: number;
  examples: TaxonomyExample[];
}

export interface TaxonomySignature {
  signature: string;
  cards: number;
  categories: string[];
  examples: TaxonomyExample[];
}

export interface TaxonomyReport {
  cards: number;
  cardsWithText: number;
  mappedCards: number;
  unmappedCards: number;
  buckets: TaxonomyBucket[];
  topUnmappedSignatures: TaxonomySignature[];
}

interface CategoryPattern {
  id: string;
  label: string;
  re: RegExp;
}

const CATEGORY_PATTERNS: CategoryPattern[] = [
  { id: "raid", label: "Raid / Replacement", re: /\braid\b|switch to active\. may move to the front line/i },
  { id: "step", label: "Step / Movement Keyword", re: /\bstep\b|during your movement phase.*front line.*energy line/i },
  { id: "double_block", label: "Double Block / Block Refresh", re: /blocks for the first time this turn, switch it to active/i },
  { id: "alias_identity", label: "Alias / Name Treatment", re: /also treated as <[^>]+>|also treated as/i },
  { id: "impact", label: "Impact / Damage Modifier", re: /\bimpact\b|direct damage.*deal \d damage|attacks and wins a battle, deal/i },
  { id: "nullify_impact", label: "Nullify Battle Keyword", re: /battling this character loses/i },
  { id: "battle_restriction", label: "Battle Restriction / Replacement", re: /cannot be blocked|cannot block|cannot move|lose to this character.*instead/i },
  { id: "draw_filter", label: "Draw / Hand Filtering", re: /\bdraw (?:a|one|two|three|\d+) cards?|place one card from your hand/i },
  { id: "search_deck", label: "Deck Search / Reveal", re: /look at the top (?:card|two|three|four|five|seven|\d+) cards? of your deck|reveal up to/i },
  { id: "peek_reorder", label: "Peek / Reorder Deck", re: /place it on the top or bottom|top of your deck or into your sideline|remaining cards on the top/i },
  { id: "mill_self", label: "Self Mill / Sideline From Deck", re: /place the top (?:card|two|three|\d+) cards? of your deck into your sideline/i },
  { id: "sideline_retrieval", label: "Sideline Retrieval", re: /from your sideline to your hand|from your sideline.*add.*to your hand|add .* from your sideline/i },
  { id: "removal_sideline", label: "Opponent Removal: Sideline", re: /opponent.*(?:front line|field).*sideline it|sideline.*opponent.*character|resting character.*sideline/i },
  { id: "removal_bounce", label: "Opponent Removal: Return To Hand", re: /opponent.*(?:front line|field).*return it to their hand/i },
  { id: "removal_energy_or_life", label: "Opponent Removal: Energy/Life/Deck", re: /opponent.*(?:move it to their energy line|place it.*life|bottom of their deck)/i },
  { id: "rest_freeze", label: "Rest / Freeze", re: /switch .* to resting|remain set to resting/i },
  { id: "bp_buff", label: "BP Buff", re: /gains? \d+ bp|gains? \{?\d+ bp\}?|give this character \d+ bp/i },
  { id: "bp_debuff", label: "BP Debuff", re: /loses? \d+ bp|loses? \{?\d+ bp\}?/i },
  { id: "energy_generation", label: "Energy Generation", re: /gains energy generation|energy generation/i },
  { id: "required_energy_reduction", label: "Required Energy Reduction", re: /reduce this card's required energy|reduce .* required energy/i },
  { id: "ap_refresh", label: "AP Refresh", re: /ap cards? and switch .* to active|switch .* ap cards? to active/i },
  { id: "ap_cost_reduction", label: "AP Cost Reduction", re: /reduce .* ap cost|ap cost .* reduced/i },
  { id: "own_bounce", label: "Own Field Return To Hand", re: /return one other character on your field|return .* on your field .* to your hand/i },
  { id: "own_sideline_cost", label: "Own Sideline Cost / Sacrifice", re: /sideline one .* on your field|sideline this character|one other character on your field.*sideline/i },
  { id: "line_move_swap", label: "Move / Swap Lines", re: /move it to the other line|swap them|front line to your energy line|move .* to .* energy line|moves outside of your movement phase/i },
  { id: "play_from_hand", label: "Play From Hand", re: /play up to one .* from your hand|play this .* onto your field|play this character/i },
  { id: "under_card", label: "Under Card / Face-Down Stack", re: /face down under|under this character|under .* card/i },
  { id: "hand_disruption", label: "Opponent Hand Disruption", re: /opponent places one card from their hand|opponent reveals .* hand/i },
  { id: "opponent_deck_control", label: "Opponent Deck Control", re: /opponent reveals the top card of their deck|top card of their deck/i },
  { id: "trigger_related", label: "Trigger-Related", re: /trigger ability|activated a trigger|perform raid.*trigger/i },
  { id: "choice_modal", label: "Choice / Modal Effects", re: /choose one of the following|of the abilities listed below/i },
  { id: "site_effect", label: "Site Effects", re: /\bsite\b|this site's ability/i },
];

const MAX_EXAMPLES = 5;

function normalizeText(text: string): string {
  return text
    .replace(/\r?\n/g, " ")
    .replace(/<[^>]+>/g, "<CARD>")
    .replace(/\[[^\]]+\]/g, "[AFFINITY]")
    .replace(/\{([^}]+)\}/g, "$1")
    .replace(/\b\d+\b/g, "N")
    .replace(/\s+/g, " ")
    .trim();
}

function classifyText(text: string): string[] {
  const found: string[] = [];
  for (const pattern of CATEGORY_PATTERNS) {
    if (pattern.re.test(text) && !found.includes(pattern.id)) found.push(pattern.id);
  }
  return found.length > 0 ? found : ["uncategorized"];
}

function exampleFor(card: RawCard): TaxonomyExample {
  const def = toCardDef(card);
  return {
    id: card.id,
    name: card.name,
    timing: card.effectTiming || (card.type === "event" ? "Event" : ""),
    type: card.type,
    text: card.effectText,
    mappedEffectIds: def.effectIds,
  };
}

function addExample(list: TaxonomyExample[], example: TaxonomyExample): void {
  if (list.length < MAX_EXAMPLES) list.push(example);
}

function loadCanonicalCards(setsDir: string): RawCard[] {
  const rawCards: RawCard[] = [];
  for (const file of readdirSync(setsDir).filter((item) => item.endsWith(".json")).sort()) {
    const parsed = CardSetSchema.parse(JSON.parse(readFileSync(resolve(setsDir, file), "utf8")));
    for (const rawJson of parsed.cards) {
      rawCards.push(RawCardSchema.parse(rawJson));
    }
  }
  return canonicalPlayableCards(rawCards);
}

export function taxonomyReport(setsDir: string): TaxonomyReport {
  const cards = loadCanonicalCards(setsDir);
  const bucketMap = new Map<string, TaxonomyBucket>();
  const signatureMap = new Map<string, TaxonomySignature>();
  let cardsWithText = 0;
  let mappedCards = 0;

  for (const pattern of CATEGORY_PATTERNS) {
    bucketMap.set(pattern.id, {
      id: pattern.id,
      label: pattern.label,
      cards: 0,
      mappedCards: 0,
      unmappedCards: 0,
      examples: [],
    });
  }
  bucketMap.set("uncategorized", {
    id: "uncategorized",
    label: "Uncategorized",
    cards: 0,
    mappedCards: 0,
    unmappedCards: 0,
    examples: [],
  });

  for (const card of cards) {
    const text = card.effectText.trim();
    if (!text) continue;
    cardsWithText++;
    const def = toCardDef(card);
    const isMapped = def.effectIds.length > 0;
    if (isMapped) mappedCards++;
    const example = exampleFor(card);
    const categories = classifyText(text);

    for (const category of categories) {
      const bucket = bucketMap.get(category);
      if (!bucket) continue;
      bucket.cards++;
      if (isMapped) bucket.mappedCards++;
      else bucket.unmappedCards++;
      addExample(bucket.examples, example);
    }

    if (!isMapped) {
      const signature = normalizeText(text);
      const existing = signatureMap.get(signature) ?? {
        signature,
        cards: 0,
        categories,
        examples: [],
      };
      existing.cards++;
      for (const category of categories) {
        if (!existing.categories.includes(category)) existing.categories.push(category);
      }
      addExample(existing.examples, example);
      signatureMap.set(signature, existing);
    }
  }

  const buckets = [...bucketMap.values()]
    .filter((bucket) => bucket.cards > 0)
    .sort((a, b) => b.cards - a.cards || a.id.localeCompare(b.id));

  const topUnmappedSignatures = [...signatureMap.values()]
    .sort((a, b) => b.cards - a.cards || a.signature.localeCompare(b.signature))
    .slice(0, 40);

  return {
    cards: cards.length,
    cardsWithText,
    mappedCards,
    unmappedCards: cardsWithText - mappedCards,
    buckets,
    topUnmappedSignatures,
  };
}

export function categoryLabel(id: string): string {
  return CATEGORY_PATTERNS.find((pattern) => pattern.id === id)?.label ?? "Uncategorized";
}
