# Next Steps

## Best Immediate Track

1. Ship the GitHub Pages static demo so the UI is easy to open and test.
2. Tighten the single-player/static demo loop until core interactions feel obvious.
3. Host the WebSocket server separately once the frontend flow is worth sharing live.

## Product Priorities

- **Frontend-only demo polish:** add a reset button, better error messages, clearer disabled states, and scripted fixture states for attack, trigger, raid, and end-turn testing.
- **Rules coverage:** keep encoding card text into data-driven effects, especially energy generation, search/get effects, removal, and common combat modifiers.
- **Deckbuilder:** local deck list editor, validation, import/export, and choosing a deck before joining a room.
- **Multiplayer hardening:** room lifecycle, reconnects, spectators, server-side room cleanup, and server deploy config.
- **Data pipeline:** scrape/import more sets while keeping generated card JSON/images out of public git unless we decide otherwise.

## Hosting Plan

- GitHub Pages: static frontend and demo mode.
- Later server host: Fly.io, Railway, Render, or a VPS running `apps/server`.
- Once a server URL exists, set `VITE_WS_URL=wss://...` in the Pages build environment.
