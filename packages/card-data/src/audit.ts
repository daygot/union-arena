import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { toCardDef } from "./mapper.js";
import {
  canonicalPlayableCards,
  groupCardsByProduct,
  isAlternateArt,
  isApCard,
  productFileName,
  productGroupKey,
} from "./normalize.js";
import { CardSetSchema, RawCardSchema, type RawCard } from "./schema.js";

export interface AuditIssue {
  level: "error" | "warning";
  code: string;
  message: string;
}

export interface AuditProductSummary {
  productCode: string;
  rawPrintings: number;
  canonicalCards: number;
  apPrintings: number;
  alternateArtPrintings: number;
}

export interface AuditReport {
  files: number;
  rawPrintings: number;
  canonicalCards: number;
  apPrintings: number;
  alternateArtPrintings: number;
  products: AuditProductSummary[];
  issues: AuditIssue[];
}

function issue(issues: AuditIssue[], level: AuditIssue["level"], code: string, message: string): void {
  issues.push({ level, code, message });
}

function expectedSourceCode(cardNumber: string): string {
  return cardNumber.split("-")[0] ?? "";
}

function validateRawCard(card: RawCard, issues: AuditIssue[], seenPrintingIds: Set<string>): void {
  if (card.id !== `${card.setCode}/${card.cardNumber}`) {
    issue(issues, "error", "id-mismatch", `${card.id}: id does not match setCode/cardNumber.`);
  }

  const expectedSource = expectedSourceCode(card.cardNumber);
  if (card.sourceCode !== expectedSource) {
    issue(issues, "error", "source-mismatch", `${card.id}: sourceCode ${card.sourceCode} should be ${expectedSource}.`);
  }

  const printingKey = [
    card.id,
    card.name,
    card.rarity,
    card.imageUrl,
    card.localImage ?? "",
  ].join("\u0000");
  if (seenPrintingIds.has(printingKey)) {
    issue(issues, "warning", "duplicate-printing", `${card.id}: duplicate raw printing record.`);
  }
  seenPrintingIds.add(printingKey);

  if (isApCard(card) && card.type !== "ap") {
    issue(issues, "warning", "ap-type-mismatch", `${card.id}: AP printing is stored as type ${card.type}.`);
  }

  if (!isApCard(card) && card.color == null) {
    issue(issues, "error", "missing-color", `${card.id}: non-AP card has no color.`);
  }

  if (card.type === "character" && !isApCard(card) && !isAlternateArt(card) && card.bp == null) {
    issue(issues, "warning", "character-missing-bp", `${card.id}: canonical character has no BP.`);
  }
}

function validateCanonicalCard(card: RawCard, issues: AuditIssue[], seenRulesIds: Set<string>): void {
  const key = `${productGroupKey(card)}/${card.cardNumber}`;
  if (seenRulesIds.has(key)) {
    issue(issues, "error", "duplicate-canonical", `${key}: duplicate canonical playable card.`);
  }
  seenRulesIds.add(key);

  if (isApCard(card)) {
    issue(issues, "error", "ap-in-canonical", `${card.id}: AP card appeared in canonical playable cards.`);
  }
  if (isAlternateArt(card)) {
    issue(issues, "error", "alt-art-in-canonical", `${card.id}: alternate art appeared in canonical playable cards.`);
  }

  try {
    toCardDef(card);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    issue(issues, "error", "mapper-failed", `${card.id}: toCardDef failed: ${detail}`);
  }
}

export function auditCardData(setsDir: string): AuditReport {
  const issues: AuditIssue[] = [];
  const files = readdirSync(setsDir)
    .filter((file) => file.endsWith(".json"))
    .sort();

  const rawCards: RawCard[] = [];
  const seenPrintingIds = new Set<string>();

  for (const file of files) {
    const filePath = resolve(setsDir, file);
    let parsed;
    try {
      parsed = CardSetSchema.parse(JSON.parse(readFileSync(filePath, "utf8")));
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      issue(issues, "error", "file-parse-failed", `${file}: failed to parse: ${detail}`);
      continue;
    }

    const fileProducts = new Set<string>();
    for (const rawJson of parsed.cards) {
      const raw = RawCardSchema.parse(rawJson);
      rawCards.push(raw);
      fileProducts.add(productGroupKey(raw));
      validateRawCard(raw, issues, seenPrintingIds);
    }

    if (fileProducts.size > 1) {
      issue(issues, "warning", "mixed-product-file", `${file}: contains ${fileProducts.size} product/source groups.`);
    }

    const first = parsed.cards[0];
    if (first) {
      const expectedFile = productFileName(first);
      if (file !== expectedFile) {
        issue(issues, "warning", "filename-mismatch", `${file}: expected ${expectedFile}.`);
      }
    }
  }

  const canonical = canonicalPlayableCards(rawCards);
  const seenRulesIds = new Set<string>();
  for (const card of canonical) {
    validateCanonicalCard(card, issues, seenRulesIds);
  }

  const products = [...groupCardsByProduct(rawCards).entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([productCode, cards]) => ({
      productCode,
      rawPrintings: cards.length,
      canonicalCards: canonicalPlayableCards(cards).length,
      apPrintings: cards.filter(isApCard).length,
      alternateArtPrintings: cards.filter(isAlternateArt).length,
    }));

  return {
    files: files.length,
    rawPrintings: rawCards.length,
    canonicalCards: canonical.length,
    apPrintings: rawCards.filter(isApCard).length,
    alternateArtPrintings: rawCards.filter(isAlternateArt).length,
    products,
    issues,
  };
}
