// Loads real scraped card data and assembles demo decks for the skeleton.
// NOTE: this is a dev/demo loader. Real deckbuilding + validation happens later;
// here we just need legal-enough decks to drive the engine on screen.
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { toCardDef, RawCardSchema } from "@union-arena/card-data";
import type { CardDef } from "@union-arena/core";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Path to the scraped card-data package assets. */
const SETS_DIR = resolve(__dirname, "../../../packages/card-data/data/sets");
export const IMAGES_DIR = resolve(__dirname, "../../../packages/card-data/data/images");

export interface LoadedCards {
  defs: Record<string, CardDef>;
  /** Card numbers usable as deck entries (characters/sites/events; not AP). */
  playable: string[];
  apCardId: string;
}

/** A tiny built-in AP card so the demo works even without a scraped AP card. */
const DEMO_AP: CardDef = {
  id: "DEMO-AP",
  cardNumber: "DEMO-AP",
  sourceCode: "DEMO",
  name: "AP",
  type: "site",
  color: "yellow",
  requiredEnergy: [],
  apCost: 0,
  energyGeneration: [],
  affinities: [],
  keywords: [],
  hasTrigger: false,
  effectIds: [],
  text: "Action Point card.",
};

/** Load every scraped set into a defs map + list of playable card numbers. */
export function loadCards(imageBaseUrl = `http://localhost:${process.env.PORT ?? 8787}/cards`): LoadedCards {
  const defs: Record<string, CardDef> = { [DEMO_AP.cardNumber]: DEMO_AP };
  const playable: string[] = [];

  const setFiles = existsSync(SETS_DIR)
    ? readdirSync(SETS_DIR).filter((file) => file.endsWith(".json")).sort()
    : [];
  for (const file of setFiles) {
    const p = resolve(SETS_DIR, file);
    if (!existsSync(p)) continue;
    const json = JSON.parse(readFileSync(p, "utf8"));
    for (const rawJson of json.cards ?? []) {
      const raw = RawCardSchema.parse(rawJson);
      const def = toCardDef(raw);
      if (raw.localImage) def.imageUrl = `${imageBaseUrl}/${encodeURIComponent(raw.localImage)}`;
      defs[def.cardNumber] = def;
      if (def.type === "character" || def.type === "site" || def.type === "event") {
        playable.push(def.cardNumber);
      }
    }
  }

  return { defs, playable, apCardId: DEMO_AP.cardNumber };
}

/** Build a 50-card demo deck by repeating available playable cards. */
export function demoDeck(loaded: LoadedCards): { cards: string[]; apCardId: string } {
  const { playable, apCardId } = loaded;
  const cards: string[] = [];
  if (playable.length === 0) {
    throw new Error("No playable cards scraped yet. Run the card-data scraper first.");
  }
  let i = 0;
  while (cards.length < 50) {
    cards.push(playable[i % playable.length]!);
    i++;
  }
  return { cards, apCardId };
}
