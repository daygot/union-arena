// Orchestrates scraping a whole title: list page -> per-card detail pages -> RawCard[].
import { Fetcher } from "./fetcher.js";
import { parseCardListIndex, parseDetail } from "./parser.js";
import { RawCardSchema, type RawCard } from "./schema.js";

const BASE = "https://www.unionarena-tcg.com";
const LIST_URL = `${BASE}/na/cardlist/index.php?search=true`;
const DETAIL_URL = `${BASE}/na/cardlist/detail_iframe.php`;

export interface ScrapeOptions {
  cacheDir: string;
  throttleMs?: number;
  /** Optional cap for testing (scrape only the first N cards). */
  limit?: number;
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
    cards.push(parsed);
    done++;
    opts.onProgress?.(done, entries.length, parsed.name);
  }
  return cards;
}
