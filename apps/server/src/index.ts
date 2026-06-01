// Authoritative WebSocket server. Hosts game rooms; clients connect and propose
// intents. The server runs the deterministic core engine and broadcasts state.
import { createReadStream, existsSync } from "node:fs";
import { createServer } from "node:http";
import { basename, extname, join } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import { GameRoom, sharedCards } from "./room.js";
import { IMAGES_DIR } from "./decks.js";
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

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? `localhost:${PORT}`}`);
  if (url.pathname.startsWith("/cards/")) {
    const file = decodeURIComponent(url.pathname.slice("/cards/".length));
    const safe = basename(file);
    const path = join(IMAGES_DIR, safe);
    if (!existsSync(path)) {
      res.writeHead(404).end("Not found");
      return;
    }
    const type = extname(path).toLowerCase() === ".png" ? "image/png" : "application/octet-stream";
    res.writeHead(200, { "Content-Type": type, "Cache-Control": "public, max-age=3600" });
    createReadStream(path).pipe(res);
    return;
  }

  res.writeHead(200, { "Content-Type": "text/plain" }).end("union-arena server\n");
});

const wss = new WebSocketServer({ server });
server.listen(PORT, () => {
  console.log(`[union-arena] authoritative server listening on ws://localhost:${PORT}`);
  console.log(`[union-arena] card images served from http://localhost:${PORT}/cards/`);
});

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
