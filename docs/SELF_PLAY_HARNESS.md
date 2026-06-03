# Self-Play Harness Notes

Goal: let an automated, deterministic player drive the real engine reducer so we can find gameplay bugs before manual testing does.

## First Milestone

Build a headless harness in `packages/card-data`, not `packages/core`, because it needs the real card corpus:

- load canonical cards from `packages/card-data/data/sets`
- map raw cards through `toCardDef`
- generate simple 50-card decks from one product/source group
- create a game with `createGame`
- drive it only through `applyIntent`
- validate invariants after every accepted intent
- return a transcript with seed, product, step, intent, and failure reason

## Why Headless First

The reducer is the authoritative rules engine. A headless harness is fast, deterministic, and good at catching state corruption:

- duplicated or orphaned card instances
- cards both in a zone and under a Raid stack
- pending triggers also present in normal zones
- missing defs/instances
- line size overflow
- invalid pending attack references

Browser automation should come later, after this exists, to catch UI-only problems like missing buttons and bad disabled states.

## Current Implementation

`packages/card-data/src/selfplay.ts` currently contains:

- `SelfPlayStep`
- `SelfPlayFailure`
- `SelfPlayResult`
- `validateSelfPlayInvariants(state)`
- `formatSelfPlayFailure(failure)`
- corpus/deck generation helpers
- legal-ish candidate intent generation
- `runSelfPlay(options)`

There is also:

- `packages/card-data/src/selfplay.test.ts`, including a short deterministic SAKAMOTO DAYS run.
- `pnpm --filter @union-arena/card-data selfplay -- --games 200 --steps 300 --seed 1234`
- `pnpm --filter @union-arena/card-data selfplay -- --games 200 --steps 400 --seed 1234 --bias-effects`

Use `--bias-effects` when hunting gameplay bugs around abilities. It still uses the same reducer and invariant checks, but orders generated intents so active triggers, manual abilities, events, and Raid lines are tried before generic play/attack/phase choices.

Next implementation step:

1. Improve the bot's target choices for card-specific effects that currently rely on first-target fallbacks.
2. Track effect coverage counts per run so we can see which effect ids were actually exercised.
3. Run longer cross-product hunts and turn any failure transcript into a regression test.
4. Add a browser/Playwright layer that uses similar high-level decisions to catch UI-only bugs.

## Intent Generator Sketch

Priority order:

1. If `pendingTriggers`, resolve the first trigger. Prefer activating only when an obvious legal target exists; otherwise decline.
2. If `pendingAttack`, block with first active front-line blocker when possible; otherwise reveal the first required life cards.
3. If phase is `start`, use `extraDraw` once when available, then advance.
4. If phase is `movement`, occasionally move energy-line characters to front if space exists; occasionally move Step characters back to energy.
5. If phase is `main`, try affordable Raid, play affordable characters/sites/events, activate visible abilities, then advance.
6. If phase is `attack`, attack with active front-line characters, then advance.
7. If phase is `end`, advance/end turn.

The bot should not duplicate full reducer validation. It can propose candidates, apply them, and keep the first accepted result.

## Failure Output Shape

```text
selfplay failed
seed=1234 product=UE19BT/SMD step=87
reason=duplicate iid p1-c-17 appears in energyLine and under p1-c-24
last={"type":"raid","seat":"p1","iid":"p1-c-3","targetIid":"p1-c-17"}

transcript:
1 p1 {"type":"mulligan","seat":"p1","keep":true}
2 p2 {"type":"mulligan","seat":"p2","keep":true}
...
```
