// Orchestrates scraping a whole title: list page -> per-card detail pages -> RawCard[].
import { join } from "node:path";
import { Fetcher } from "./fetcher.js";
import { parseCardListIndex, parseDetail } from "./parser.js";
import { RawCardSchema, type RawCard } from "./schema.js";

/** Filesystem-safe filename for a card's image, e.g. UE19BT_SMD-1-001.png. */
function imageFileName(cardNumber: string, setCode: string): string {
  return `${setCode}_${cardNumber}.png`;
}

const BASE = "https://www.unionarena-tcg.com";
const LIST_URL = `${BASE}/na/cardlist/index.php?search=true`;
const DETAIL_URL = `${BASE}/na/cardlist/detail_iframe.php`;

export interface ScrapeOptions {
  cacheDir: string;
  throttleMs?: number;
  /** Optional cap for testing (scrape only the first N cards). */
  limit?: number;
  /** If set, download each card image into this directory (filename = <cardNo>.png). */
  imagesDir?: string;
  onProgress?: (done: number, total: number, name: string) => void;
}

/** Scrape every card for a given title (e.g. "SAKAMOTO DAYS"). */
export async function scrapeTitle(title: string, opts: ScrapeOptions): Promise<RawCard[]> {
  const fetcher = new Fetcher({ cacheDir: opts.cacheDir, throttleMs: opts.throttleMs ?? 800 });

  const listHtml = await fetcher.postForm(LIST_URL, { selectTitle: title });
  let entries = parseCardListIndex(listHtml);
  if (opts.limit) entries = entries.slice(0, opts.limit);

  const cards: RawCard[] = [];
  let done = 0;
  for (const entry of entries) {
    const url = `${DETAIL_URL}?card_no=${encodeURIComponent(entry.cardNo)}`;
    const detailHtml = await fetcher.get(url);
    const raw = parseDetail(detailHtml, { imageBaseUrl: BASE });
    // Prefer the list image path if the detail page lacked one.
    if (!raw.imageUrl && entry.imagePath) {
      raw.imageUrl = new URL(entry.imagePath, BASE).toString();
    }
    const parsed = RawCardSchema.parse(raw);

    // Optionally download the card image and rewrite imageUrl to the local path.
    if (opts.imagesDir && parsed.imageUrl) {
      const file = imageFileName(parsed.cardNumber, parsed.setCode);
      const dest = join(opts.imagesDir, file);
      try {
        await fetcher.download(parsed.imageUrl, dest);
        parsed.localImage = file;
      } catch (e) {
        // Non-fatal: keep the remote URL if the image fails.
        opts.onProgress?.(done, entries.length, `image failed: ${parsed.cardNumber}`);
      }
    }

    cards.push(parsed);
    done++;
    opts.onProgress?.(done, entries.length, parsed.name);
  }
  return cards;
}
