# Union Arena Sim

Browser-first prototype for playing Union Arena online with an authoritative rules engine.

## Current Shape

- `packages/core`: deterministic game state, intents, phases, combat, triggers, effects, raid helpers.
- `packages/card-data`: official card list parser/scraper tooling. Generated card data and images stay out of git.
- `apps/server`: Node/WebSocket room host for real-time multiplayer.
- `apps/web`: React/Vite board UI. It can run against the WebSocket server or in a static browser-only demo.

## Local Dev

```bash
corepack pnpm install
corepack pnpm --filter @union-arena/server start
corepack pnpm --filter @union-arena/web dev
```

Open `http://localhost:5173/?room=demo` in two tabs for a live local room.

For a frontend-only smoke test:

```bash
corepack pnpm --filter @union-arena/web dev
```

Open `http://localhost:5173/?demo=static`.

## GitHub Pages

GitHub Pages serves the static web build from the `gh-pages` branch.

The hosted build supports:

- `?demo=static` for a browser-only demo using the real core reducer and tiny sample cards.
- `?room=...` for live multiplayer only after a WebSocket server is hosted and `VITE_WS_URL` is configured before building.

## Checks

```bash
corepack pnpm -r test
corepack pnpm --filter @union-arena/web typecheck
corepack pnpm --filter @union-arena/web build
```
