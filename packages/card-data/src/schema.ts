// Normalized card schema for the self-maintained dataset.
// This is the on-disk JSON shape. A separate mapper converts it to the engine's CardDef.
import { z } from "zod";

export const ColorSchema = z.enum(["red", "blue", "green", "yellow", "purple"]);
export const CardTypeSchema = z.enum(["character", "site", "event", "ap"]);

export const EnergySchema = z.object({
  color: ColorSchema,
  amount: z.number().int().nonnegative(),
});

/**
 * Trigger types. Only special/color/final are deck-capped (see core rules).
 * "none" = the card has no trigger.
 */
export const TriggerTypeSchema = z.enum([
  "none",
  "special",
  "color",
  "final",
  "get",
  "draw",
  "active",
  "raid",
]);

export const RawCardSchema = z.object({
  /** Full printed id, e.g. "UE19BT/SMD-1-001". */
  id: z.string().min(1),
  /** Card number portion, e.g. "SMD-1-001". */
  cardNumber: z.string().min(1),
  /** Franchise/source code, e.g. "SMD". */
  sourceCode: z.string().min(1),
  /** Set / product code, e.g. "UE19BT". */
  setCode: z.string().min(1),
  setName: z.string().default(""),
  name: z.string().min(1),
  rarity: z.string().default(""),
  type: CardTypeSchema,
  color: ColorSchema.nullable(),
  requiredEnergy: z.array(EnergySchema).default([]),
  apCost: z.number().int().nonnegative().default(0),
  bp: z.number().int().nonnegative().nullable().default(null),
  generatedEnergy: z.array(EnergySchema).default([]),
  affinities: z.array(z.string()).default([]),
  /** Main ability text (verbatim). */
  effectText: z.string().default(""),
  /** Trigger ability text (verbatim), empty when no trigger. */
  triggerText: z.string().default(""),
  triggerType: TriggerTypeSchema.default("none"),
  imageUrl: z.string().default(""),
  /** Local image filename relative to the set's images dir (set when downloaded). */
  localImage: z.string().optional(),
  /** Provenance + cache freshness. */
  source: z.string().default("unionarena-tcg.com"),
  scrapedAt: z.string().default(""),
});

export type RawCard = z.infer<typeof RawCardSchema>;
export type Energy = z.infer<typeof EnergySchema>;

export const CardSetSchema = z.object({
  setCode: z.string(),
  setName: z.string().default(""),
  cards: z.array(RawCardSchema),
  scrapedAt: z.string().default(""),
});
export type CardSet = z.infer<typeof CardSetSchema>;
