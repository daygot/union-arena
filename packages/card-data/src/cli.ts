// CLI: scrape a title and write a normalized JSON dataset.
// Usage: pnpm --filter @union-arena/card-data scrape "SAKAMOTO DAYS" [--limit N]
import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { scrapeTitle } from "./scraper.js";
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
  const title = process.argv[2];
  if (!title || title.startsWith("--")) {
    console.error('Usage: scrape "<TITLE>" [--limit N]');
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
