// CLI: scrape a title and write a normalized JSON dataset.
// Usage: pnpm --filter @union-arena/card-data scrape "SAKAMOTO DAYS" [--limit N]
import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { coverageReport } from "./coverage.js";
import { listTitles, scrapeTitle } from "./scraper.js";
import { CardSetSchema } from "./schema.js";

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
      console.log(`${set.setCode}\t${set.cards} cards\t${set.cardsWithMappedEffects} mapped (${pct}%)\t${set.setName}`);
    }
    const totalPct = report.totals.cards === 0
      ? 0
      : Math.round((report.totals.cardsWithMappedEffects / report.totals.cards) * 100);
    console.log(`TOTAL\t${report.totals.cards} cards\t${report.totals.cardsWithMappedEffects} mapped (${totalPct}%)`);
    console.log(`Effects\t${JSON.stringify(report.totals.mappedEffectIds)}`);
    console.log(`Triggers\t${JSON.stringify(report.totals.triggerTypes)}`);
    return;
  }

  const title = process.argv[2];
  if (!title || title.startsWith("--")) {
    console.error('Usage: scrape "<TITLE>" [--limit N] [--images]');
    console.error("       scrape --list-titles");
    console.error("       scrape --coverage");
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

  const setCode = cards[0]?.setCode ?? "UNKNOWN";
  const setName = cards[0]?.setName ?? title;
  const dataset = CardSetSchema.parse({
    setCode,
    setName,
    cards,
    scrapedAt: new Date().toISOString(),
  });

  await mkdir(OUT_DIR, { recursive: true });
  const outPath = join(OUT_DIR, `${setCode}.json`);
  await writeFile(outPath, JSON.stringify(dataset, null, 2), "utf-8");
  console.error(`Wrote ${cards.length} cards -> ${outPath}`);
  if (withImages) {
    const dl = cards.filter((c) => c.localImage).length;
    console.error(`Images: ${dl}/${cards.length} available under ${IMAGES_DIR}`);
  }
}

main().catch((e) => {
  console.error("\nScrape failed:", e);
  process.exit(1);
});
