// Parsers for the official unionarena-tcg.com NA card list.
// - parseCardListIndex: extract (card_no, name, image) entries from a title search result page.
// - parseDetail: extract full card fields from a detail_iframe.php page.
import { parse, type HTMLElement } from "node-html-parser";
import type { Energy, RawCard } from "./schema.js";
import type { Color } from "@union-arena/core";

const COLOR_MAP: Record<string, Color> = {
  red: "red",
  blue: "blue",
  green: "green",
  yellow: "yellow",
  purple: "purple",
};

export interface ListEntry {
  /** e.g. "UE19BT/SMD-1-001" */
  cardNo: string;
  name: string;
  imagePath: string;
}

export function parseCardListIndex(html: string): ListEntry[] {
  const root = parse(html);
  const out: ListEntry[] = [];
  for (const a of root.querySelectorAll(".cardlistCol .cardImgCol a")) {
    const href = a.getAttribute("href") ?? "";
    const m = href.match(/card_no=([^&]+)/);
    if (!m) continue;
    const cardNo = decodeURIComponent(m[1]!);
    const img = a.querySelector("img");
    const alt = img?.getAttribute("alt") ?? "";
    const imagePath = img?.getAttribute("data-src") ?? img?.getAttribute("src") ?? "";
    // alt = "UE19BT/SMD-1-001 Obiguro" -> name is everything after the first space
    const name = alt.split(" ").slice(1).join(" ").trim();
    out.push({ cardNo, name, imagePath });
  }
  return out;
}

/** Pull color + amount out of an energy icon filename like ".../ico_..._yellow1.png". */
function parseEnergyIcons(dd: HTMLElement | null): Energy[] {
  if (!dd) return [];
  const result: Energy[] = [];
  for (const img of dd.querySelectorAll("img")) {
    const src = img.getAttribute("src") ?? "";
    const m = src.match(/_(red|blue|green|yellow|purple)(\d+)\.png/i);
    if (!m) continue;
    const color = COLOR_MAP[m[1]!.toLowerCase()];
    const amount = Number(m[2]);
    if (!color) continue;
    if (amount > 0) result.push({ color, amount });
    else result.push({ color, amount: 0 });
  }
  return result;
}

function ddText(root: HTMLElement, colClass: string): string {
  const dd = root.querySelector(`.${colClass} .cardDataContents`);
  return (dd?.text ?? "").replace(/\s+/g, " ").trim();
}

function classifyType(raw: string): RawCard["type"] {
  const t = raw.toLowerCase();
  if (t.includes("character")) return "character";
  if (t.includes("event")) return "event";
  if (t.includes("site")) return "site";
  if (t.includes("ap")) return "ap";
  return "character";
}

/** Derive a trigger type from the trigger text's leading bracketed tag, if present. */
function classifyTrigger(triggerText: string): RawCard["triggerType"] {
  if (!triggerText.trim()) return "none";
  const t = triggerText.toLowerCase();
  // Official text often leads with a bracketed label like [Special]/[Color]/[Final]/[Draw]/[Get]/[Active].
  if (/\bspecial\b/.test(t)) return "special";
  if (/\bcolor\b/.test(t)) return "color";
  if (/\bfinal\b/.test(t)) return "final";
  if (/\bdraw\b/.test(t)) return "draw";
  if (/\bget\b/.test(t)) return "get";
  if (/\bactive\b/.test(t)) return "active";
  // Has trigger text but unrecognized tag: still a trigger, type unknown -> treat as special-ish unknown.
  return "special";
}

export interface ParseDetailContext {
  imageBaseUrl: string; // e.g. "https://www.unionarena-tcg.com"
}

export function parseDetail(html: string, ctx: ParseDetailContext): RawCard {
  const root = parse(html);

  const cardNo = (root.querySelector(".cardNumData")?.text ?? "").trim(); // "UE19BT/SMD-1-001"
  const name = (root.querySelector(".cardNameCol")?.text ?? "").trim();
  const rarity = (root.querySelector(".rareData")?.text ?? "").trim();
  const products = (root.querySelector(".cardDataProductsTxt")?.text ?? "").trim();

  const [setCode = "", numberPart = ""] = cardNo.split("/");
  const sourceCode = numberPart.split("-")[0] ?? "";

  // Products text: "SAKAMOTO DAYS [UE19BT]" -> name portion.
  const setName = products.replace(/\s*\[[^\]]*\]\s*$/, "").trim();

  const apText = ddText(root, "apData").replace(/[^\d]/g, "");
  const bpText = ddText(root, "bpData").replace(/[^\d]/g, "");
  const typeText = ddText(root, "categoryData");
  const affinityText = ddText(root, "attributeData");
  const effectText = stripLabel(ddText(root, "effectData"), "Effect");
  const triggerText = stripLabel(ddText(root, "triggerData"), "Trigger");

  const requiredEnergy = parseEnergyIcons(
    root.querySelector(".needEnergyData .cardDataContents"),
  ).filter((e) => e.amount > 0);
  const generatedEnergy = parseEnergyIcons(
    root.querySelector(".generatedEnergyData .cardDataContents"),
  ).filter((e) => e.amount > 0);

  // Card color: from required energy if present, else generated energy.
  const color =
    requiredEnergy[0]?.color ?? generatedEnergy[0]?.color ?? null;

  const affinities =
    affinityText && affinityText !== "-"
      ? affinityText.split(/[\/,、]/).map((s) => s.trim()).filter(Boolean)
      : [];

  const imgEl = root.querySelector(".cardDataImgCol img");
  const imgPath = imgEl?.getAttribute("src") ?? imgEl?.getAttribute("data-src") ?? "";
  const imageUrl = imgPath ? new URL(imgPath, ctx.imageBaseUrl).toString() : "";

  return {
    id: cardNo,
    cardNumber: numberPart,
    sourceCode,
    setCode,
    setName,
    name,
    rarity,
    type: classifyType(typeText),
    color,
    requiredEnergy,
    apCost: apText ? Number(apText) : 0,
    bp: bpText ? Number(bpText) : null,
    generatedEnergy,
    affinities,
    effectText,
    triggerText,
    triggerType: classifyTrigger(triggerText),
    imageUrl,
    source: "unionarena-tcg.com",
    scrapedAt: new Date().toISOString(),
  };
}

/** Remove a leading label word ("Effect"/"Trigger") the text node sometimes includes. */
function stripLabel(text: string, label: string): string {
  const re = new RegExp(`^${label}\\s*`, "i");
  return text.replace(re, "").trim();
}
