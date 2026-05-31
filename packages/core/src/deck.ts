// Deck-construction validation. Encodes the corrected rules:
// - exactly 50 cards
// - single franchise/IP (one sourceCode)
// - <=4 copies per card number
// - <=4 cards per CAPPED trigger type (special/color/final only)
import type { CardDef } from "./types.js";
import { CAPPED_TRIGGER_TYPES } from "./types.js";

export interface DeckValidationResult {
  ok: boolean;
  errors: string[];
}

/**
 * Validate a 50-card main deck (list of CardDef ids) against the rules.
 * `defs` must contain every id referenced.
 */
export function validateDeck(cardIds: string[], defs: Record<string, CardDef>): DeckValidationResult {
  const errors: string[] = [];

  if (cardIds.length !== 50) {
    errors.push(`Deck must contain exactly 50 cards (found ${cardIds.length}).`);
  }

  const cards = cardIds.map((id) => defs[id]);
  const missing = cardIds.filter((id) => !defs[id]);
  if (missing.length) {
    errors.push(`Unknown card ids: ${[...new Set(missing)].join(", ")}.`);
    return { ok: false, errors };
  }
  const resolved = cards as CardDef[];

  // Single franchise / source code.
  const sources = new Set(resolved.map((c) => c.sourceCode));
  if (sources.size > 1) {
    errors.push(
      `All cards must be from the same franchise. Found sources: ${[...sources].join(", ")}.`,
    );
  }

  // <=4 copies per card number.
  const byNumber = new Map<string, number>();
  for (const c of resolved) byNumber.set(c.cardNumber, (byNumber.get(c.cardNumber) ?? 0) + 1);
  for (const [num, count] of byNumber) {
    if (count > 4) errors.push(`Too many copies of ${num}: ${count} (max 4).`);
  }

  // <=4 per capped trigger type (special/color/final). Others uncapped.
  const byTrigger = new Map<string, number>();
  for (const c of resolved) {
    if (c.hasTrigger && c.triggerType && CAPPED_TRIGGER_TYPES.includes(c.triggerType)) {
      byTrigger.set(c.triggerType, (byTrigger.get(c.triggerType) ?? 0) + 1);
    }
  }
  for (const [tt, count] of byTrigger) {
    if (count > 4) errors.push(`Too many "${tt}" trigger cards: ${count} (max 4).`);
  }

  return { ok: errors.length === 0, errors };
}
