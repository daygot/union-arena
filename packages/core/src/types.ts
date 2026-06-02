// Union Arena — core domain types.
// Derived from docs/RULES_MODEL.md. Keep this the single source of truth for game shape.

/** Energy / card colors. Union Arena cards each have one color, set by their required energy. */
export type Color = "red" | "blue" | "green" | "yellow" | "purple";

export type CardType = "character" | "site" | "event";

/** A required-energy or energy-generation amount, per color. */
export interface EnergySpec {
  color: Color;
  amount: number;
}

/** Keyword abilities. Encoded as flags; their hooks live in the effect system. */
export type Keyword =
  | "step"
  | "snipe"
  | "impact" // attack damage still goes through even when blocked (pierce). Amount via impactN.
  | "raid"
  | "refreshOnAttack"
  | "refreshOnBlock";

/**
 * Trigger types. Only special/color/final are subject to the 4-per-type deck cap;
 * get/draw/active are uncapped.
 */
export type TriggerType =
  | "special"
  | "color"
  | "final"
  | "get"
  | "draw"
  | "active"
  | "raid";

/** Trigger types that are limited to 4 copies per deck. */
export const CAPPED_TRIGGER_TYPES: readonly TriggerType[] = ["special", "color", "final"];

/**
 * Static, immutable card definition (one per printed card number / variant).
 * This is what the card-data package produces and the engine consumes.
 */
export interface CardDef {
  /** Full printed identifier, e.g. "UA03BT/HTR-1-001". */
  id: string;
  /** Card number used for the 4-copy limit, e.g. "HTR-1-001". */
  cardNumber: string;
  /**
   * Source material code = franchise/IP (first 3 letters of card number), e.g. "BLC".
   * A legal deck contains exactly one sourceCode (e.g. an all-Bleach deck).
   */
  sourceCode: string;
  name: string;
  type: CardType;
  color: Color;
  /** Energy required to play (may be empty for some cards). */
  requiredEnergy: EnergySpec[];
  /** Action-point cost to play/use. */
  apCost: number;
  /** Battle power (characters only). */
  bp?: number;
  /** Impact value: N damage on a direct hit, and damage pierces blocks. 0/undefined = no Impact. */
  impactN?: number;
  /** Energy this card generates while on the energy line (characters & sites). */
  energyGeneration: EnergySpec[];
  affinities: string[];
  keywords: Keyword[];
  /** Whether the card has a Trigger ability (relevant to life reveals). */
  hasTrigger: boolean;
  /** The trigger type, when hasTrigger. Drives the per-type deck cap (special/color/final). */
  triggerType?: TriggerType;
  /** Raw ability/effect identifiers; resolved by the effect registry (built incrementally). */
  effectIds: string[];
  /** Original rules/ability text for display and for not-yet-implemented effects. */
  text: string;
  imageUrl?: string;
}

/** Players are identified by seat. */
export type Seat = "p1" | "p2";

export type Orientation = "active" | "resting";

/** A concrete card instance in a game (a CardDef placed somewhere). */
export interface CardInstance {
  /** Unique per-game instance id. */
  iid: string;
  defId: string;
  owner: Seat;
  controller: Seat;
  orientation: Orientation;
  /** For Raid stacks: cards beneath the top card (top is this instance). */
  raidUnder: string[];
  /** Whether this life/face-down card has been revealed. */
  faceUp: boolean;
  /** Temporary BP delta (e.g. +3000 from an active trigger), cleared at end of turn. */
  bpModifier?: number;
  /** Temporary energy generation, cleared at end of turn. */
  energyModifier?: EnergySpec[];
  /** Some effects sideline their source at the end of the main phase. */
  sidelineAtEndOfMain?: boolean;
}

export type ZoneId =
  | "deck"
  | "hand"
  | "frontLine"
  | "energyLine"
  | "life"
  | "ap"
  | "sideline"
  | "removal";

export interface PlayerState {
  seat: Seat;
  deck: string[]; // iids, top = index 0
  hand: string[];
  frontLine: string[]; // max 4
  energyLine: string[]; // max 4
  life: string[]; // face-down until revealed
  ap: string[]; // AP card iids
  sideline: string[];
  removal: string[];
  hasMulliganed: boolean;
  extraDrawUsedThisTurn: boolean;
}

export type Phase = "start" | "movement" | "main" | "attack" | "end";

export interface GameState {
  /** Deterministic PRNG seed/state so the same inputs always replay identically. */
  rngState: number;
  turn: number;
  activeSeat: Seat;
  phase: Phase;
  players: Record<Seat, PlayerState>;
  /** All instances by iid. */
  instances: Record<string, CardInstance>;
  /** Card definitions referenced by instances (subset of the full DB used in this game). */
  defs: Record<string, CardDef>;
  /** Set when the game is over. */
  winner?: Seat;
  reason?: "life" | "deckout";
  /** Transient combat state: an attack has been declared and is awaiting a block decision. */
  pendingAttack?: PendingAttack;
  /** Transient: life cards revealed by damage that still need trigger resolution. */
  pendingTriggers?: PendingTriggers;
  /** Append-only public log of resolved events (UI + replays read this). */
  log: GameEvent[];
}

export interface PendingAttack {
  attackerIid: string;
  /** When set, a Snipe attack on an opponent character; otherwise a direct player attack. */
  targetIid?: string;
}

export interface PendingTriggers {
  /** Seat whose life is being checked (the damaged player). */
  seat: Seat;
  /** Revealed life-card iids still awaiting resolve, in order. */
  iids: string[];
}

/** Player-issued intents. The authoritative engine validates and applies these. */
export type Intent =
  | { type: "mulligan"; seat: Seat; keep: boolean }
  | { type: "extraDraw"; seat: Seat }
  | { type: "move"; seat: Seat; iid: string; to: "frontLine" | "energyLine" }
  | { type: "playCard"; seat: Seat; iid: string; to?: "frontLine" | "energyLine"; targetIid?: string }
  | { type: "raid"; seat: Seat; iid: string; targetIid: string }
  | { type: "useEvent"; seat: Seat; iid: string }
  | { type: "activateAbility"; seat: Seat; iid: string; effectId: string }
  | { type: "declareAttack"; seat: Seat; attackerIid: string; targetIid?: string }
  | { type: "declareBlock"; seat: Seat; blockerIid?: string; lifeIids?: string[] }
  | {
      type: "resolveTrigger";
      seat: Seat;
      iid: string;
      activate: boolean;
      /** Target character for triggers that pick one (active/special/color). */
      targetIid?: string;
      /** Card to play for green/purple color triggers (from hand/sideline). */
      playIid?: string;
    }
  | { type: "advancePhase"; seat: Seat }
  | { type: "endTurn"; seat: Seat };

/** Resolved, public events appended to the log. */
export type GameEvent =
  | { kind: "phase"; phase: Phase; seat: Seat; turn: number }
  | { kind: "draw"; seat: Seat; count: number }
  | { kind: "play"; seat: Seat; iid: string; to: ZoneId }
  | { kind: "move"; seat: Seat; iid: string; from: ZoneId; to: ZoneId }
  | { kind: "attack"; seat: Seat; attackerIid: string; targetIid?: string }
  | { kind: "block"; seat: Seat; blockerIid: string }
  | { kind: "battle"; attackerIid: string; defenderIid: string; winnerIid: string | null }
  | { kind: "damage"; seat: Seat; amount: number }
  | { kind: "sideline"; iid: string }
  | { kind: "trigger"; seat: Seat; iid: string; activated: boolean }
  | { kind: "win"; seat: Seat; reason: "life" | "deckout" }
  | { kind: "info"; message: string };

export interface ValidationError {
  ok: false;
  error: string;
}
export interface ApplyOk {
  ok: true;
  state: GameState;
}
export type ApplyResult = ApplyOk | ValidationError;
