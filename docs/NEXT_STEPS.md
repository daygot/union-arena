# Next Steps

## Best Immediate Track

1. Import more real cards/sets, then expand effect-pattern coverage so those cards do useful engine work.
2. Keep the board UI honest: every public zone should be visible and inspectable.
3. Use goldfish mode as a smoke test only; it should render basic functions and behaviors, not become the product.
4. Host the WebSocket server separately once the core loop is worth testing live.

## Product Priorities

- **More cards:** scrape additional official titles, keep generated cache/images out of git, and decide how much browser-safe card metadata to commit.
- **Rules coverage:** keep encoding card text into data-driven effects, especially energy generation, search/get effects, removal, life manipulation, and common combat modifiers.
- **Board UI:** show front line, energy line, hand, AP, life, deck, sideline, and removal for both players.
- **Frontend-only demo polish:** use real card metadata where possible, add a reset button, better error messages, clearer disabled states, and scripted fixture states for attack, trigger, raid, and end-turn testing.
- **Deckbuilder:** local deck list editor, validation, import/export, and choosing a deck before joining a room.
- **Multiplayer hardening:** room lifecycle, reconnects, spectators, server-side room cleanup, and server deploy config.
- **Data pipeline:** scrape/import more sets while keeping generated card JSON/images out of public git unless we decide otherwise.

## Current Local Card Corpus

- `UE19BT`: SAKAMOTO DAYS, 174 cards.
- `UE02BT`: HUNTER X HUNTER, 427 cards.
- Current effect coverage report: 601 local cards, 52 mapped effect-bearing cards. Newly covered patterns include exact draw, draw-then-sideline, refresh up to two AP, and timing-aware "When Sidelined" effects.
- Card browsing/deck data is still expanding faster than engine behavior, so the next high-leverage work is target-choice effects: removal, bounce, rest/freeze, search/look-at-top, and life manipulation.

## Hosting Plan

- GitHub Pages: static frontend and demo mode.
- Later server host: Fly.io, Railway, Render, or a VPS running `apps/server`.
- Once a server URL exists, set `VITE_WS_URL=wss://...` in the Pages build environment.
