import { useCallback, useEffect, useRef, useState } from "react";
import type { GameState, Intent, Seat } from "@union-arena/core";
import type { ClientMessage, ServerMessage } from "@union-arena/server/src/protocol.js";

const WS_URL = (import.meta as { env?: { VITE_WS_URL?: string } }).env?.VITE_WS_URL
  ?? "ws://localhost:8787";

export interface GameConnection {
  connected: boolean;
  seat: Seat | "spectator" | null;
  state: GameState | null;
  error: string | null;
  send: (intent: Intent) => void;
}

export function useGame(roomId: string): GameConnection {
  const [connected, setConnected] = useState(false);
  const [seat, setSeat] = useState<Seat | "spectator" | null>(null);
  const [state, setState] = useState<GameState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      const join: ClientMessage = { type: "join", roomId };
      ws.send(JSON.stringify(join));
    };
    ws.onclose = () => setConnected(false);
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data) as ServerMessage;
      if (msg.type === "joined") setSeat(msg.seat);
      else if (msg.type === "state") {
        setState(msg.state);
        setError(null);
      } else if (msg.type === "error") setError(msg.error);
    };

    return () => ws.close();
  }, [roomId]);

  const send = useCallback((intent: Intent) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      const msg: ClientMessage = { type: "intent", intent };
      ws.send(JSON.stringify(msg));
    }
  }, []);

  return { connected, seat, state, error, send };
}
