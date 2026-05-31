# Union Arena — Rules Model (engine reference)

Source: official rule manual (17pp), OCR'd locally to `docs/rules-raw/ua_rules_ocr.txt`.
Page images in `docs/rules-raw/pages/`. This file is the distilled, engine-facing model.

## Win Conditions
- Opponent has no cards left in their Life Area, OR
- Opponent cannot draw during their Start Phase (empty deck) → they lose.

## Deck Construction
- Exactly **50 cards**.
- All cards must be from the **same franchise / IP** (one source material code, the first 3
  letters of the card number, e.g. `BLC` for a Bleach deck or `CGH` for a Code Geass deck).
  A deck is "a Bleach deck" or "a Code Geass deck" — never mixed.
- No more than **4 copies** of any single card number.
- Trigger cap: no more than **4 cards per trigger type**, but this cap applies **only** to
  these trigger types: **Special, Color, and Final**.
  - get / draw / active triggers have **no** such limitation.
- Plus **3 AP cards** (separate from the 50).

## Card Types
- **Character** — can attack/block. Played to Front Line OR Energy Line, set to **resting**. Movable.
  - Fields: Required Energy (color+amount), AP Cost, Affinities[], Abilities[], Trigger?,
    Energy Generation icons (color+amount, only counted on Energy Line), BP, Card Number.
- **Site** — support. Energy Line only. Cannot move to front line. Set to resting on play.
  - Same field set as character minus BP/attack.
- **Event** — one-shot. Use ability, then place into Sideline. Never enters field; can be used even if lines full.
- **AP card** — 3 total. Spent (active→resting) to pay AP costs.

## Zones (per player)
- **Front Line** — up to 4 character cards. Attack & block here.
- **Energy Line** — up to 4 cards (character and/or site, any combination). Only energy generation here counts.
- **Field** = Front Line + Energy Line.
- **Life Area** — 7 cards face-down at start. Damage reveals/removes these; reveal checks Triggers.
- **AP Area** — holds AP cards.
- **Deck Area** — the deck.
- **Hand** — start 7, one mulligan allowed, max 8 at end of turn (discard extras to Removal).
- **Sideline** — face-up "discard": used events, sidelined characters/sites.
- **Removal Area** — permanently removed from game (face-up).

## Active / Resting
- Active = vertical, Resting = horizontal.
- Cards enter the field **resting**.
- Only **active** characters can attack or block; attacking/blocking switches them to resting.

## Resources
- **Energy**: each Energy-Line card shows energy-generation icons (color+count). Total per color
  must meet a card's Required Energy (color+amount) to play it. Front-line generation is ignored.
- **AP (action points)**: pay by switching active AP cards to resting.
  - AP count at start phase (set active):
    - Player One: T1=1, T2=2, T3+=3
    - Player Two: T1=2, T2=2, T3+=3

## Turn Structure
1. **Start Phase**
   - Expire "until start of next turn" abilities.
   - Switch all resting cards (chars, sites, AP) to active.
   - Top up AP cards to the table count above (set active).
   - Draw 1 (Player One skips draw on turn 1).
   - Optional once/turn **extra draw**: pay 1 AP to draw one additional card.
     - Timing: this happens **between the Start Phase and the Movement Phase** (after the
       normal start-phase draw, before movement). P1 may use it even on turn 1.
2. **Movement Phase**
   - Move any number of characters Energy Line → Front Line (simultaneous).
   - Cannot move Front → Energy unless character has **Step**.
   - Sites never move.
   - If destination full (4), send one chosen card per incoming to Removal first
     (Step into full energy line may swap instead of removing).
3. **Main Phase** (repeat A/B any order, any number of times)
   - A: Use a Card — play character / perform Raid / play site / use event
     (need Required Energy + pay AP; field cards enter resting).
   - B: Activate an Activate-ability on a field card (fulfill its conditions).
4. **Attack Phase**
   - Attack with one active front-line character at a time; switch it to resting.
   - May only target the opponent (the player) — UNLESS attacker has **Snipe**
     (then may target an opponent front-line character, which cannot block).
   - Resolve attack-triggered abilities on declaration.
   - Defender may block with one active front-line character (switch to resting).
   - No cards may be used during attack phase; no AP paid to attack.
5. **End Phase**
   - Resolve start-of-end-phase abilities.
   - Switch resting characters/sites to active (resting AP cards stay resting).
   - Discard hand down to 8 (extras → Removal).
   - Expire "until end of turn" abilities.

## Combat Resolution
- **Attacking a character** (via Snipe or block): compare BP. Neither BP changes from battle itself.
  - Attacker BP ≥ defender BP → defender loses → **sideline** defender; resolve "when sidelined" / win-battle abilities.
  - NOTE: a blocked attack normally deals **no** player damage — unless the attacker has **Impact** (see below).
  - Attacker BP < defender BP → attacker loses (NOT sidelined); resolve lose/opponent-win abilities.
- **Attacking the player**: deal 1 damage.
  - Per point of damage, attacker selects 1 life card; defender reveals & checks Trigger.
  - Trigger optional to activate; card → owner's Sideline after. No life left after → attacker wins.

## Raid
- Characters with Raid marker may be played as Raid onto a specified base character lacking Raid.
- Target spec: `<Name>` = by name, `[Affinity]` = by affinity.
- Steps: place on top of target; underlying abilities go inactive; if resting→active; may move to front line if on energy line; Raid's "on raid" abilities fire.
- Raid card may also be played normally but loses its raid-text abilities.
- If a Raided stack leaves the field to a non-field zone, move only the top card; underlying cards → Sideline (not "sidelined").

## Keywords (encode as engine flags/hooks)
- **Step** — may move front→energy in movement phase.
- **Snipe** — attack an opponent front-line character; it can't block; no block abilities fire; battle still happens.
- **(Attack)/(Block) refresh** — "switch to active when it attacks/blocks first time this turn" (some chars).
- **Impact** — the attack's damage **still goes through even if the attack is blocked**
  (pierce-like). On its own it does NOT change the damage amount.
  - **Impact N** — when this attack deals damage to the player, deal **N** damage
    (e.g. Impact 2 = 2 damage), and it still goes through when blocked.
  - (The OCR'd base-set manual phrased "Impact ●" as "deal 2 instead"; the current game
    treats plain Impact as pierce and Impact N as the damage amount. Trust this model.)
- **Damage (●)** — extra trigger-check / additional damage variants (see page 15-16).
- **Trigger** — ability usable when revealed from Life Area on damage (optional). Trigger types capped at 4/deck.

## Trigger Types (HARD-CODED, fixed by rules — user-confirmed 2026-05-31)

When a life card is revealed on damage, its Trigger (if any) is one of these fixed types.
Resolution is deterministic per type. The revealed card is the "trigger source"; the
"trigger player" is the player being attacked (the one who revealed it).

1. **get** — the revealed card is added to the trigger player's hand (instead of going to sideline).
2. **draw** — the trigger player draws 1 card from their deck.
3. **active** — the trigger player chooses one of their characters, switches it to **active**,
   and it gains **+3000 BP** (until end of turn).
4. **color** — effect depends on the **color of the revealed card**:
   - **Red:** sideline one opponent front-line character with **BP ≤ 2500**.
   - **Blue:** return (bounce) one opponent front-line character with **BP ≤ 3500** to its owner's hand.
   - **Green:** play one character with **AP cost ≤ 2** from the trigger player's **hand** onto the
     field, **active**.
   - **Purple:** play one character with **AP cost ≤ 2** from the trigger player's **sideline** onto
     the **front line**, **active**.
   - (Yellow has no listed color trigger here — treat as no-op unless a card says otherwise.)
5. **special** — sideline one character on the opponent's front line (any BP).
6. **final** — if this is the trigger player's **last** life card, they may put the **top card of
   their deck** into their life area (i.e. they don't lose; life is replenished by 1).
7. **raid** — the trigger player may **EITHER** perform **Raid** with the revealed card onto one
   of their own field characters (if they meet the revealed card's energy requirement), **OR**
   simply add the revealed card to hand.

Confirmed edge cases (user 2026-05-31):
- **final disposition:** the revealed final card goes to the **sideline**; the top-of-deck card
  goes to life → net life unchanged on that hit.
- **no legal target:** a trigger that needs a target/play with none available **fizzles silently**
  (no effect), since all triggers are optional anyway.

Notes:
- get / draw / active are uncapped in deckbuilding; special / color / final are capped at 4 each.
- All triggers are **optional** to activate (player may decline). After resolution the revealed
  card goes to the **sideline**, EXCEPT **get** (goes to hand) and **final** (the top-of-deck card
  goes to life; the revealed card itself still goes to sideline).
- **Once Per Turn** — per-copy-on-field once/turn; re-played copy counts as new.
- **Phrase substitution** — `{A} ... {B} instead` conditional text swaps.

## Simultaneous Abilities
- Turn player resolves all their simultaneous abilities first, then non-turn player.
- Newly-triggered abilities join the pool, resolved in any order by their controller.

## Engine Implications
- State must be fully **authoritative & deterministic** (server-owned).
- Abilities are the hard part: model as data-driven **effects** with triggers
  (onPlay, onAttack, onBlock, onSidelined, onWinBattle, onLoseBattle, trigger, activate, startOfEndPhase, etc.).
- Targeting grammar: by name `<...>`, by affinity `[...]`, "up to N", "choose", etc.
- Keep card data layer swappable (scraped data → normalized schema → engine).
