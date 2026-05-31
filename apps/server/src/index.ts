// Authoritative WebSocket server. Hosts game rooms; clients connect and propose
// intents. The server runs the deterministic core engine and broadcasts state.
import { WebSocketServer, type WebSocket } from "ws";
import { GameRoom, sharedCards } from "./room.js";
import type { ClientMessage, ServerMessage } from "./protocol.js";
import type { Seat } from "@union-arena/core";

const PORT = Number(process.env.PORT ?? 8787);

const rooms = new Map<string, GameRoom>();
function getRoom(id: string): GameRoom {
  let room = rooms.get(id);
  if (!room) {
    room = new GameRoom(id, sharedCards());
    rooms.set(id, room);
  }
  return room;
}

const wss = new WebSocketServer({ port: PORT });
console.log(`[union-arena] authoritative server listening on ws://localhost:${PORT}`);

wss.on("connection", (ws: WebSocket) => {
  let room: GameRoom | null = null;
  let seat: Seat | "spectator" = "spectator";

  const send = (msg: ServerMessage | unknown) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  };

  ws.on("message", (data) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(String(data));
    } catch {
      send({ type: "error", error: "Invalid JSON." } satisfies ServerMessage);
      return;
    }

    if (msg.type === "join") {
      room = getRoom(msg.roomId);
      seat = room.join(send);
      send({ type: "joined", roomId: msg.roomId, seat } satisfies ServerMessage);
      send({ type: "state", state: room.getState() } satisfies ServerMessage);
      return;
    }

    if (msg.type === "intent") {
      if (!room) {
        send({ type: "error", error: "Join a room first." } satisfies ServerMessage);
        return;
      }
      const err = room.submit(seat, msg.intent);
      if (err) send({ type: "error", error: err } satisfies ServerMessage);
      return;
    }
  });

  ws.on("close", () => {
    if (room) room.leave(seat, send);
  });
});
