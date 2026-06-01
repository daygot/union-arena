import { useCallback, useMemo, useState } from "react";
import {
  __resetIidCounter,
  applyIntent,
  beginFirstTurn,
  createGame,
  type CardDef,
  type GameState,
  type Intent,
} from "@union-arena/core";
import type { GameConnection } from "./useGame.js";

function def(partial: Partial<CardDef> & { id: string; name: string }): CardDef {
  return {
    cardNumber: partial.id,
    sourceCode: "DMO",
    type: "character",
    color: "red",
    requiredEnergy: [],
    apCost: 1,
    bp: 1000,
    energyGeneration: [{ color: "red", amount: 1 }],
    affinities: [],
    keywords: [],
    hasTrigger: false,
    effectIds: [],
    text: "",
    ...partial,
  };
}

const DEMO_DEFS: Record<string, CardDef> = {
  AP: def({
    id: "AP",
    name: "AP",
    type: "site",
    color: "yellow",
    apCost: 0,
    energyGeneration: [],
    text: "Action Point card.",
  }),
  ENERGY: def({
    id: "ENERGY",
    name: "Training Grounds",
    type: "site",
    color: "red",
    apCost: 0,
    energyGeneration: [{ color: "red", amount: 1 }],
    text: "Generates red energy while on the energy line.",
  }),
  ROOKIE: def({
    id: "ROOKIE",
    name: "Rookie Fighter",
    bp: 1000,
    apCost: 1,
    text: "A small character for testing play and attack flow.",
  }),
  STEP: def({
    id: "STEP",
    name: "Step Specialist",
    bp: 1500,
    keywords: ["step"],
    text: "Step",
  }),
  STRIKER: def({
    id: "STRIKER",
    name: "Union Striker",
    bp: 3000,
    requiredEnergy: [{ color: "red", amount: 1 }],
    apCost: 1,
    text: "A heavier body that asks you to set up energy first.",
  }),
  RAID: def({
    id: "RAID",
    name: "Raid Captain",
    bp: 4000,
    requiredEnergy: [{ color: "red", amount: 1 }],
    apCost: 1,
    keywords: ["raid"],
    text: "Raid",
  }),
};

function makeDeck(): string[] {
  const pattern = ["ENERGY", "ROOKIE", "STEP", "STRIKER", "RAID"];
  return Array.from({ length: 50 }, (_, i) => pattern[i % pattern.length]!);
}

function createDemoState(): GameState {
  __resetIidCounter();
  let state = createGame({
    seed: 20260601,
    defs: DEMO_DEFS,
    decks: {
      p1: { cards: makeDeck(), apCardId: "AP" },
      p2: { cards: makeDeck(), apCardId: "AP" },
    },
  });
  state = {
    ...state,
    players: {
      p1: { ...state.players.p1, hasMulliganed: true },
      p2: { ...state.players.p2, hasMulliganed: true },
    },
  };
  return beginFirstTurn(state);
}

export function useStaticDemoGame(): GameConnection {
  const [state, setState] = useState(createDemoState);
  const [error, setError] = useState<string | null>(null);
  const seat = useMemo(() => "p1" as const, []);

  const send = useCallback((intent: Intent) => {
    setState((current) => {
      const result = applyIntent(current, intent);
      if (!result.ok) {
        setError(result.error);
        return current;
      }
      setError(null);
      return result.state;
    });
  }, []);

  return {
    connected: true,
    seat,
    state,
    error,
    send,
  };
}
