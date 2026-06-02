import { useCallback, useState } from "react";
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
    sourceCode: "SMD",
    type: "character",
    color: "yellow",
    requiredEnergy: [],
    apCost: 1,
    bp: 1000,
    energyGeneration: [{ color: "yellow", amount: 1 }],
    affinities: [],
    keywords: [],
    hasTrigger: false,
    effectIds: [],
    text: "",
    ...partial,
  };
}

const DEMO_DEFS: Record<string, CardDef> = {
  "DEMO-AP": def({
    id: "DEMO-AP",
    cardNumber: "DEMO-AP",
    sourceCode: "DEMO",
    name: "AP",
    type: "site",
    color: "yellow",
    apCost: 0,
    energyGeneration: [],
    text: "Action Point card.",
  }),
  "SMD-1-001": def({
    id: "UE19BT/SMD-1-001",
    cardNumber: "SMD-1-001",
    name: "Obiguro",
    bp: 500,
    effectIds: ["buff_other_3000_eot_on_sideline"],
    hasTrigger: true,
    triggerType: "active",
    text: "Choose up to one other character on your field. It gains 3000 BP until the end of the turn.\nChoose one character on your field and switch it to active. It gains 3000 BP until the end of the turn.",
    imageUrl: "https://www.unionarena-tcg.com/na/images/cardlist/card/UE19BT_SMD-1-001.png?v3",
  }),
  "SMD-1-002": def({
    id: "UE19BT/SMD-1-002",
    cardNumber: "SMD-1-002",
    name: "Piisuke",
    bp: 1000,
    energyGeneration: [{ color: "yellow", amount: 2 }],
    effectIds: ["energy_generation_eot_and_sideline_on_activate"],
    text: "This character gains energy generation and \"At the end of the main phase, sideline this character\" until the end of the turn.",
    imageUrl: "https://www.unionarena-tcg.com/na/images/cardlist/card/UE19BT_SMD-1-002.png?v3",
  }),
  "SMD-1-003": def({
    id: "UE19BT/SMD-1-003",
    cardNumber: "SMD-1-003",
    name: "Boiled",
    bp: 3500,
    effectIds: ["block_guard_2000"],
    text: "(When this character blocks for the first time this turn, switch it to active.) If your opponent's attacking character has 3000 or less base BP, this character gains 2000 BP until the end of the battle.",
    imageUrl: "https://www.unionarena-tcg.com/na/images/cardlist/card/UE19BT_SMD-1-003.png?v3",
  }),
  "SMD-1-004": def({
    id: "UE19BT/SMD-1-004",
    cardNumber: "SMD-1-004",
    name: "Heisuke Mashimo",
    bp: 1500,
    hasTrigger: true,
    triggerType: "get",
    text: "Add this card to your hand.",
    imageUrl: "https://www.unionarena-tcg.com/na/images/cardlist/card/UE19BT_SMD-1-004.png?v3",
  }),
  "SMD-1-007": def({
    id: "UE19BT/SMD-1-007",
    cardNumber: "SMD-1-007",
    name: "Heisuke Mashimo",
    bp: 4000,
    apCost: 1,
    requiredEnergy: [{ color: "yellow", amount: 1 }],
    hasTrigger: true,
    triggerType: "draw",
    text: "Choose up to one character on your opponent's front line. Place it face up into their life area.\nDraw a card.",
    imageUrl: "https://www.unionarena-tcg.com/na/images/cardlist/card/UE19BT_SMD-1-007.png?v3",
  }),
  "SMD-1-008": def({
    id: "UE19BT/SMD-1-008",
    cardNumber: "SMD-1-008",
    name: "Heisuke Mashimo",
    bp: 4000,
    apCost: 1,
    requiredEnergy: [{ color: "yellow", amount: 1 }],
    keywords: ["raid"],
    hasTrigger: true,
    triggerType: "raid",
    text: "<Heisuke Mashimo> Switch to active. May move to the front line. This character gains until the end of the turn. Turn up to one of your life cards face up. Your opponent chooses one of their life cards. If it is face down, turn it face up. If there are a combined total of three or more face-up cards in your and your opponent's decks and life areas, this character gains until the end of the turn.\nAdd this card to your hand, or if you have the required energy, perform Raid with it.",
    imageUrl: "https://www.unionarena-tcg.com/na/images/cardlist/card/UE19BT_SMD-1-008.png?v3",
  }),
  "SMD-1-009": def({
    id: "UE19BT/SMD-1-009",
    cardNumber: "SMD-1-009",
    name: "Lu Wutang",
    bp: 2000,
    effectIds: ["draw_card_on_play"],
    text: "Draw a card.",
    imageUrl: "https://www.unionarena-tcg.com/na/images/cardlist/card/UE19BT_SMD-1-009.png?v3",
  }),
};

function makeDeck(): string[] {
  const pattern = ["SMD-1-001", "SMD-1-002", "SMD-1-003", "SMD-1-004", "SMD-1-007", "SMD-1-008", "SMD-1-009"];
  return Array.from({ length: 50 }, (_, i) => pattern[i % pattern.length]!);
}

function createDemoState(): GameState {
  __resetIidCounter();
  let state = createGame({
    seed: 20260601,
    defs: DEMO_DEFS,
    decks: {
      p1: { cards: makeDeck(), apCardId: "DEMO-AP" },
      p2: { cards: makeDeck(), apCardId: "DEMO-AP" },
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

function requiredActor(state: GameState): "p1" | "p2" {
  if (state.pendingTriggers) return state.pendingTriggers.seat;
  if (state.pendingAttack) return state.activeSeat === "p1" ? "p2" : "p1";
  return state.activeSeat;
}

export function useGoldfishGame(): GameConnection {
  const [state, setState] = useState(createDemoState);
  const [error, setError] = useState<string | null>(null);
  const seat = requiredActor(state);

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
