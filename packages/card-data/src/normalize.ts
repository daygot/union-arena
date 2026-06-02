import type { RawCard } from "./schema.js";

/** AP printings are collectible action-point cards, not playable deck cards. */
export function isApCard(card: Pick<RawCard, "type" | "cardNumber" | "name">): boolean {
  return (
    card.type === "ap" ||
    /\bAP\d*\b/i.test(card.cardNumber) ||
    /^action point card\b/i.test(card.name)
  );
}

/** Star rarities are cosmetic alternate-art printings of a base rules card. */
export function isAlternateArt(card: Pick<RawCard, "rarity">): boolean {
  return card.rarity.includes("★");
}

/** True when a raw printing should participate in gameplay/effect coverage. */
export function isCanonicalPlayablePrinting(card: RawCard): boolean {
  return !isApCard(card) && !isAlternateArt(card);
}

/**
 * Collapse raw printings into one gameplay card per set/card number.
 *
 * The official title pages include alternate arts and AP collectibles. Keeping
 * those in raw data is useful for images/collection metadata, but gameplay wants
 * the base non-star printing exactly once.
 */
export function canonicalPlayableCards(cards: RawCard[]): RawCard[] {
  const byRulesId = new Map<string, RawCard>();
  for (const card of cards) {
    if (!isCanonicalPlayablePrinting(card)) continue;
    const key = productGroupKey(card) + `/${card.cardNumber}`;
    if (!byRulesId.has(key)) byRulesId.set(key, card);
  }
  return [...byRulesId.values()].sort((a, b) => {
    const setCmp = a.setCode.localeCompare(b.setCode);
    return setCmp === 0 ? a.cardNumber.localeCompare(b.cardNumber) : setCmp;
  });
}

export function productGroupKey(card: Pick<RawCard, "setCode" | "sourceCode">): string {
  return `${card.setCode}/${card.sourceCode}`;
}

export function productFileName(card: Pick<RawCard, "setCode" | "sourceCode">): string {
  return `${card.setCode}_${card.sourceCode}.json`;
}

export function groupCardsByProduct(cards: RawCard[]): Map<string, RawCard[]> {
  const byProduct = new Map<string, RawCard[]>();
  for (const card of cards) {
    const key = productGroupKey(card);
    const group = byProduct.get(key) ?? [];
    group.push(card);
    byProduct.set(key, group);
  }
  return byProduct;
}
