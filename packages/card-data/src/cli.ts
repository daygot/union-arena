// CLI: scrape a title and write a normalized JSON dataset.
// Usage: pnpm --filter @union-arena/card-data scrape "SAKAMOTO DAYS" [--limit N]
import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { auditCardData } from "./audit.js";
import { coverageReport } from "./coverage.js";
import { listTitles, scrapeTitle } from "./scraper.js";
import { CardSetSchema } from "./schema.js";
import { taxonomyReport } from "./taxonomy.js";
import { groupCardsByProduct, productFileName } from "./normalize.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// packages/card-data/src -> data lives under packages/card-data/data (gitignored)
const DATA_DIR = join(__dirname, "..", "data");
const CACHE_DIR = join(DATA_DIR, "cache");
const OUT_DIR = join(DATA_DIR, "sets");
const IMAGES_DIR = join(DATA_DIR, "images");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  if (process.argv.includes("--list-titles")) {
    const titles = await listTitles({ cacheDir: CACHE_DIR });
    for (const title of titles) {
      console.log(`${title.id}\t${title.name}`);
    }
    return;
  }

  if (process.argv.includes("--coverage")) {
    const report = coverageReport(OUT_DIR);
    for (const set of report.sets) {
      const pct = set.cards === 0 ? 0 : Math.round((set.cardsWithMappedEffects / set.cards) * 100);
      console.log(
        `${set.productCode}\t${set.cards} canonical cards\t${set.cardsWithMappedEffects} mapped (${pct}%)\t` +
        `${set.rawPrintings} printings, ${set.alternateArtPrintings} alt arts, ${set.apPrintings} AP\t${set.setName}`,
      );
    }
    const totalPct = report.totals.cards === 0
      ? 0
      : Math.round((report.totals.cardsWithMappedEffects / report.totals.cards) * 100);
    console.log(
      `TOTAL\t${report.totals.cards} canonical cards\t${report.totals.cardsWithMappedEffects} mapped (${totalPct}%)\t` +
      `${report.totals.rawPrintings} printings, ${report.totals.alternateArtPrintings} alt arts, ${report.totals.apPrintings} AP`,
    );
    console.log(`Effects\t${JSON.stringify(report.totals.mappedEffectIds)}`);
    console.log(`Triggers\t${JSON.stringify(report.totals.triggerTypes)}`);
    return;
  }

  if (process.argv.includes("--audit")) {
    const report = auditCardData(OUT_DIR);
    console.log(
      `AUDIT\t${report.files} files\t${report.canonicalCards} canonical cards\t` +
      `${report.rawPrintings} printings\t${report.alternateArtPrintings} alt arts\t${report.apPrintings} AP`,
    );
    for (const product of report.products) {
      console.log(
        `${product.productCode}\t${product.canonicalCards} canonical\t${product.rawPrintings} printings\t` +
        `${product.alternateArtPrintings} alt arts\t${product.apPrintings} AP`,
      );
    }
    const errors = report.issues.filter((item) => item.level === "error");
    const warnings = report.issues.filter((item) => item.level === "warning");
    console.log(`ISSUES\t${errors.length} errors\t${warnings.length} warnings`);
    for (const item of report.issues.slice(0, 200)) {
      console.log(`${item.level.toUpperCase()}\t${item.code}\t${item.message}`);
    }
    if (report.issues.length > 200) {
      console.log(`... ${report.issues.length - 200} more issues omitted`);
    }
    if (errors.length > 0) process.exit(1);
    return;
  }

  if (process.argv.includes("--taxonomy")) {
    const report = taxonomyReport(OUT_DIR);
    const mappedPct = report.cardsWithText === 0
      ? 0
      : Math.round((report.mappedCards / report.cardsWithText) * 100);
    console.log(
      `TAXONOMY\t${report.cards} canonical cards\t${report.cardsWithText} with text\t` +
      `${report.mappedCards} mapped (${mappedPct}%)\t${report.unmappedCards} unmapped`,
    );
    console.log("BUCKETS");
    for (const bucket of report.buckets) {
      console.log(`${bucket.id}\t${bucket.cards} cards\t${bucket.mappedCards} mapped\t${bucket.unmappedCards} unmapped\t${bucket.label}`);
      for (const example of bucket.examples.slice(0, 2)) {
        console.log(`  EX\t${example.id}\t${example.name}\t${example.timing}\t${example.text}`);
      }
    }
    console.log("TOP_UNMAPPED_SIGNATURES");
    for (const signature of report.topUnmappedSignatures) {
      console.log(`${signature.cards} cards\t${signature.categories.join(",")}\t${signature.signature}`);
      for (const example of signature.examples.slice(0, 2)) {
        console.log(`  EX\t${example.id}\t${example.name}\t${example.timing}`);
      }
    }
    return;
  }

  const title = process.argv[2];
  if (!title || title.startsWith("--")) {
    console.error('Usage: scrape "<TITLE>" [--limit N] [--images]');
    console.error("       scrape --list-titles");
    console.error("       scrape --coverage");
    console.error("       scrape --audit");
    console.error("       scrape --taxonomy");
    process.exit(1);
  }
  const limitStr = arg("--limit");
  const limit = limitStr ? Number(limitStr) : undefined;
  const withImages = process.argv.includes("--images");
  const imagesDir = withImages ? IMAGES_DIR : undefined;

  console.error(`Scraping "${title}"${limit ? ` (limit ${limit})` : ""}${withImages ? " +images" : ""}...`);
  const cards = await scrapeTitle(title, {
    cacheDir: CACHE_DIR,
    limit,
    ...(imagesDir ? { imagesDir } : {}),
    onProgress: (done, total, name) => {
      process.stderr.write(`\r  [${done}/${total}] ${name.padEnd(40).slice(0, 40)}`);
    },
  });
  process.stderr.write("\n");

  await mkdir(OUT_DIR, { recursive: true });
  for (const [, setCards] of groupCardsByProduct(cards)) {
    const firstCard = setCards[0];
    if (!firstCard) continue;
    const setCode = firstCard.setCode;
    const setName = setCards[0]?.setName ?? title;
    const dataset = CardSetSchema.parse({
      setCode,
      setName,
      cards: setCards,
      scrapedAt: new Date().toISOString(),
    });
    const outPath = join(OUT_DIR, productFileName(firstCard));
    await writeFile(outPath, JSON.stringify(dataset, null, 2), "utf-8");
    console.error(`Wrote ${setCards.length} cards -> ${outPath}`);
  }
  if (withImages) {
    const dl = cards.filter((c) => c.localImage).length;
    console.error(`Images: ${dl}/${cards.length} available under ${IMAGES_DIR}`);
  }
}

main().catch((e) => {
  console.error("\nScrape failed:", e);
  process.exit(1);
});
