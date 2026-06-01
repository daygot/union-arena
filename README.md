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

Open `http://localhost:5173/?demo=goldfish`.

## GitHub Pages

GitHub Pages serves the static web build from the `gh-pages` branch.

Build Pages locally with:

```bash
corepack pnpm --filter @union-arena/web build:pages
```

The hosted build supports:

- `?demo=goldfish` for a browser-only single-player goldfish mode using the real core reducer and real sample cards.
- `?room=...` for live multiplayer only after a WebSocket server is hosted and `VITE_WS_URL` is configured before building.

## Checks

```bash
corepack pnpm -r test
corepack pnpm --filter @union-arena/web typecheck
corepack pnpm --filter @union-arena/web build
```

## Card Data

Generated set JSON, HTML cache, and downloaded images live under `packages/card-data/data/` and are intentionally gitignored.

```bash
corepack pnpm --filter @union-arena/card-data scrape --list-titles
corepack pnpm --filter @union-arena/card-data scrape "HUNTER X HUNTER"
corepack pnpm --filter @union-arena/card-data scrape "SAKAMOTO DAYS" --images
corepack pnpm --filter @union-arena/card-data scrape --coverage
```

`apps/server` loads every `*.json` file in `packages/card-data/data/sets`, so newly scraped sets become available to the local WebSocket demo without code changes.
