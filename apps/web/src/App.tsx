import { type FormEvent, useState } from "react";
import type { CardDef, CardInstance, GameState, Seat } from "@union-arena/core";
import { EFFECTS } from "@union-arena/core";
import { useGoldfishGame } from "./staticDemo.js";
import { useGame } from "./useGame.js";

/** Activatable (manual) ability ids on a card, for UI buttons. */
function activatableEffects(def: CardDef): string[] {
  return def.effectIds.filter((id) => EFFECTS[id]?.when === "activate");
}

function currentRoomId(): string | null {
  const room = new URLSearchParams(location.search).get("room")?.trim();
  return room || null;
}

function isGoldfishDemo(): boolean {
  const demo = new URLSearchParams(location.search).get("demo");
  return demo === "goldfish" || demo === "static";
}

function normalizeRoomId(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32);
}

function makeRoomId(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return `room-${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

function roomUrl(roomId: string): string {
  const url = new URL(location.href);
  url.searchParams.set("room", roomId);
  return url.toString();
}

function activeApCount(state: GameState, seat: Seat): number {
  return state.players[seat].ap.filter((iid) => state.instances[iid]?.orientation === "active").length;
}

function hasRequiredEnergy(state: GameState, seat: Seat, card: CardDef): boolean {
  const pool = new Map<string, number>();
  for (const iid of state.players[seat].energyLine) {
    const def = state.defs[state.instances[iid]!.defId]!;
    for (const energy of def.energyGeneration) {
      pool.set(energy.color, (pool.get(energy.color) ?? 0) + energy.amount);
    }
  }
  return card.requiredEnergy.every((energy) => (pool.get(energy.color) ?? 0) >= energy.amount);
}

function canPayForCard(state: GameState, seat: Seat, card: CardDef): boolean {
  return activeApCount(state, seat) >= card.apCost && hasRequiredEnergy(state, seat, card);
}

export function App() {
  if (isGoldfishDemo()) return <GameTable roomId="goldfish" goldfish />;
  const roomId = currentRoomId();
  if (!roomId) return <Lobby />;
  return <GameTable roomId={roomId} />;
}

function Lobby() {
  const [roomCode, setRoomCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  const goToRoom = (raw: string) => {
    const next = normalizeRoomId(raw);
    if (!next) {
      setError("Enter a room code first.");
      return;
    }
    location.href = roomUrl(next);
  };

  const host = () => {
    location.href = roomUrl(makeRoomId());
  };

  const openGoldfish = () => {
    const url = new URL(location.href);
    url.search = "";
    url.searchParams.set("demo", "goldfish");
    location.href = url.toString();
  };

  const join = (event: FormEvent) => {
    event.preventDefault();
    goToRoom(roomCode);
  };

  return (
    <main className="lobby">
      <section className="lobby-panel">
        <div className="brand lobby-brand">⚔️ Union Arena</div>
        <form className="lobby-form" onSubmit={join}>
          <button type="button" onClick={host}>Host Game</button>
          <button type="button" className="secondary" onClick={openGoldfish}>Goldfish</button>
          <div className="join-row">
            <input
              value={roomCode}
              onChange={(e) => {
                setRoomCode(e.target.value);
                setError(null);
              }}
              placeholder="room code"
              autoCapitalize="none"
              autoComplete="off"
              spellCheck={false}
            />
            <button type="submit">Join</button>
          </div>
          {error && <div className="lobby-error">{error}</div>}
        </form>
      </section>
    </main>
  );
}

function GameTable(props: { roomId: string; goldfish?: boolean }) {
  const { roomId, goldfish = false } = props;
  const live = useGame(roomId, !goldfish);
  const demo = useGoldfishGame();
  const { connected, seat, state, error, send } = goldfish ? demo : live;
  const [selected, setSelected] = useState<string | null>(null);
  const [raidSource, setRaidSource] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  const [previewIid, setPreviewIid] = useState<string | null>(null);

  if (!connected) return <Center>{error ?? "Connecting to server..."}</Center>;
  if (!state || seat == null) return <Center>Joining room “{roomId}”…</Center>;

  const me: Seat = seat === "spectator" ? "p1" : seat;
  const opp: Seat = me === "p1" ? "p2" : "p1";
  const myTurn = seat !== "spectator" && state.activeSeat === seat;
  const defender: Seat = state.activeSeat === "p1" ? "p2" : "p1";
  const pendingAttack = state.pendingAttack;
  const pendingTriggers = state.pendingTriggers;
  const triggerIid = pendingTriggers?.iids[0] ?? null;
  const triggerDef = triggerIid ? state.defs[state.instances[triggerIid]!.defId]! : null;
  const canUseTurnActions = myTurn && !pendingAttack && !pendingTriggers;
  const canRespondToAttack = seat !== "spectator" && pendingAttack && seat === defender;
  const canResolveTrigger = seat !== "spectator" && pendingTriggers?.seat === seat && triggerIid != null;
  const awaitingMulligans =
    state.turn === 1 &&
    state.phase === "start" &&
    (!state.players.p1.hasMulliganed || !state.players.p2.hasMulliganed);
  const def = (iid: string): CardDef => state.defs[state.instances[iid]!.defId]!;
  const inspectedIid = selected ?? previewIid;
  const inspectedDef = inspectedIid ? def(inspectedIid) : null;

  const act = (fn: () => void) => {
    fn();
    setSelected(null);
    setRaidSource(null);
  };

  const owner = (iid: string): Seat => state.instances[iid]!.controller;
  const isMine = (iid: string): boolean => seat !== "spectator" && owner(iid) === seat;

  const canSelect = (iid: string): boolean => {
    if (seat === "spectator" || state.winner) return false;
    const inst = state.instances[iid]!;
    const p = state.players[seat];
    const other = state.players[seat === "p1" ? "p2" : "p1"];

    if (raidSource) {
      const card = def(iid);
      return (
        card.type === "character" &&
        !card.keywords.includes("raid") &&
        inst.raidUnder.length === 0 &&
        (p.frontLine.includes(iid) || p.energyLine.includes(iid))
      );
    }

    if (canResolveTrigger && triggerDef) {
      switch (triggerDef.triggerType) {
        case "active":
          return p.frontLine.includes(iid);
        case "special":
          return other.frontLine.includes(iid);
        case "color":
          if (triggerDef.color === "red" || triggerDef.color === "blue") {
            return other.frontLine.includes(iid);
          }
          if (triggerDef.color === "green") return p.hand.includes(iid);
          if (triggerDef.color === "purple") return p.sideline.includes(iid);
          return false;
        case "raid":
          return p.frontLine.includes(iid) || p.energyLine.includes(iid);
        default:
          return false;
      }
    }

    if (canRespondToAttack) {
      return p.frontLine.includes(iid) && inst.orientation === "active";
    }

    if (!canUseTurnActions) return false;
    if (state.phase === "main") {
      if (p.hand.includes(iid)) return canPayForCard(state, seat, def(iid));
      return p.frontLine.includes(iid) || p.energyLine.includes(iid);
    }
    if (state.phase === "attack") {
      return p.frontLine.includes(iid) && inst.orientation === "active";
    }
    if (state.phase === "movement") {
      return isMine(iid) && (p.frontLine.includes(iid) || p.energyLine.includes(iid));
    }
    return false;
  };

  const selectedCanBlock =
    selected != null &&
    seat !== "spectator" &&
    state.players[seat].frontLine.includes(selected) &&
    state.instances[selected]!.orientation === "active";

  const selectedCanRaidOnto =
    raidSource != null &&
    selected != null &&
    seat !== "spectator" &&
    canSelect(selected);

  const triggerNeedsSelection = (): boolean => {
    if (!triggerDef) return false;
    if (triggerDef.triggerType === "active" || triggerDef.triggerType === "special") return true;
    if (triggerDef.triggerType === "raid") return false;
    if (triggerDef.triggerType !== "color") return false;
    return ["red", "blue", "green", "purple"].includes(triggerDef.color);
  };

  const selectedFitsTrigger = (): boolean => {
    return selected != null && canSelect(selected);
  };

  const resolveTrigger = (activate: boolean) => {
    if (seat === "spectator" || !triggerIid || !triggerDef) return;
    const base = { type: "resolveTrigger" as const, seat, iid: triggerIid, activate };
    if (!activate) {
      act(() => send(base));
      return;
    }
    if (
      selected &&
      (triggerDef.triggerType === "active" ||
        triggerDef.triggerType === "special" ||
        triggerDef.triggerType === "raid" ||
        (triggerDef.triggerType === "color" && (triggerDef.color === "red" || triggerDef.color === "blue")))
    ) {
      act(() => send({ ...base, targetIid: selected }));
      return;
    }
    if (
      selected &&
      triggerDef.triggerType === "color" &&
      (triggerDef.color === "green" || triggerDef.color === "purple")
    ) {
      act(() => send({ ...base, playIid: selected }));
      return;
    }
    act(() => send(base));
  };

  const copyInvite = async () => {
    try {
      await navigator.clipboard.writeText(roomUrl(roomId));
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
  };

  const openSeat = () => {
    window.open(roomUrl(roomId), "_blank", "noopener,noreferrer");
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">⚔️ Union Arena</div>
        <div className="meta">
          <span>Room <b>{roomId}</b></span>
          <span>You are <b className={`seat ${seat}`}>{seat}</b></span>
          <span>Turn <b>{state.turn}</b></span>
          <span>Phase <b className="phase">{state.phase}</b></span>
          <span className={myTurn ? "turn-on" : "turn-off"}>
            {state.winner
              ? `🏆 ${state.winner} wins (${state.reason})`
              : myTurn ? "● your turn" : `waiting on ${state.activeSeat}`}
          </span>
          {goldfish && <span className="demo-pill">goldfish</span>}
        </div>
        <div className="top-actions">
          {!goldfish && (
            <>
              <button onClick={copyInvite}>{copyStatus === "copied" ? "Copied" : copyStatus === "failed" ? "Copy Failed" : "Copy Invite"}</button>
              <button onClick={openSeat}>Open Second Seat</button>
            </>
          )}
          <button onClick={() => { location.href = location.pathname; }}>Lobby</button>
        </div>
      </header>

      {error && <div className="error">⚠ {error}</div>}

      <main className="board">
        <PlayerSide
          label="Opponent"
          who={opp}
          state={state}
          def={def}
          viewer={seat}
          canSelect={canSelect}
          selected={selected}
          onSelect={setSelected}
          onPreview={setPreviewIid}
          flip
        />

        <div className="midline">
          {awaitingMulligans && seat !== "spectator" && (
            <div className="actions prompt mulligan-prompt">
              {state.players[seat].hasMulliganed ? (
                <span>Waiting for opponent mulligan decision.</span>
              ) : (
                <>
                  <span>Opening hand: keep or take one mulligan.</span>
                  <button onClick={() => act(() => send({ type: "mulligan", seat, keep: true }))}>
                    Keep
                  </button>
                  <button onClick={() => act(() => send({ type: "mulligan", seat, keep: false }))}>
                    Mulligan
                  </button>
                </>
              )}
              <span className="mulligan-status">
                p1 {state.players.p1.hasMulliganed ? "ready" : "choosing"} · p2 {state.players.p2.hasMulliganed ? "ready" : "choosing"}
              </span>
            </div>
          )}

          {canRespondToAttack && (
            <div className="actions prompt">
              <span>Choose a blocker or take the hit.</span>
              {selectedCanBlock && (
                <button onClick={() => act(() => send({ type: "declareBlock", seat: me, blockerIid: selected }))}>
                  Block with selected
                </button>
              )}
              <button onClick={() => act(() => send({ type: "declareBlock", seat: me }))}>
                No Block
              </button>
            </div>
          )}

          {canResolveTrigger && triggerDef && (
            <div className="actions prompt">
              <span>
                Trigger: <b>{triggerDef.name}</b> ({triggerDef.triggerType})
              </span>
              <button
                disabled={triggerNeedsSelection() && !selectedFitsTrigger()}
                onClick={() => resolveTrigger(true)}
              >
                Activate Trigger
              </button>
              <button onClick={() => resolveTrigger(false)}>
                Decline
              </button>
            </div>
          )}

          {raidSource && seat !== "spectator" && (
            <div className="actions prompt">
              <span>
                Raid: <b>{def(raidSource).name}</b> onto a base character.
              </span>
              {selectedCanRaidOnto && (
                <button onClick={() => act(() => send({ type: "raid", seat, iid: raidSource, targetIid: selected! }))}>
                  Raid onto selected
                </button>
              )}
              <button onClick={() => act(() => {})}>
                Cancel
              </button>
            </div>
          )}

          {canUseTurnActions && !raidSource && !awaitingMulligans && (
            <div className="actions">
              <button onClick={() => act(() => send({ type: "advancePhase", seat: me }))}>
                Advance Phase →
              </button>
              <button onClick={() => act(() => send({ type: "endTurn", seat: me }))}>
                End Turn
              </button>
              {state.phase === "start" && (
                <button onClick={() => act(() => send({ type: "extraDraw", seat: me }))}>
                  Extra Draw (1 AP)
                </button>
              )}
              {selected && state.phase === "main" && (
                <>
                  {state.players[me].hand.includes(selected) && (
                    <>
                      <button onClick={() => act(() => send({ type: "playCard", seat: me, iid: selected, to: "frontLine" }))}>
                        Play → Front Line
                      </button>
                      <button onClick={() => act(() => send({ type: "playCard", seat: me, iid: selected, to: "energyLine" }))}>
                        Play → Energy Line
                      </button>
                      {def(selected).keywords.includes("raid") && (
                        <button onClick={() => { setRaidSource(selected); setSelected(null); }}>
                          Raid
                        </button>
                      )}
                    </>
                  )}
                </>
              )}
              {selected && state.phase === "movement" && (
                <>
                  {state.players[me].frontLine.includes(selected) && (
                    <button onClick={() => act(() => send({ type: "move", seat: me, iid: selected, to: "energyLine" }))}>
                      Move → Energy Line
                    </button>
                  )}
                  {state.players[me].energyLine.includes(selected) && (
                    <button onClick={() => act(() => send({ type: "move", seat: me, iid: selected, to: "frontLine" }))}>
                      Move → Front Line
                    </button>
                  )}
                </>
              )}
              {selected && state.phase === "attack" && (
                <button onClick={() => act(() => send({ type: "declareAttack", seat: me, attackerIid: selected }))}>
                  Attack with selected
                </button>
              )}
              {selected &&
                (state.players[me].frontLine.includes(selected) ||
                  state.players[me].energyLine.includes(selected)) &&
                activatableEffects(def(selected)).map((eid) => (
                  <button
                    key={eid}
                    title={EFFECTS[eid]?.text}
                    onClick={() => act(() => send({ type: "activateAbility", seat: me, iid: selected, effectId: eid }))}
                  >
                    Activate: {eid}
                  </button>
                ))}
            </div>
          )}
        </div>

        <PlayerSide
          label="You"
          who={me}
          state={state}
          def={def}
          viewer={seat}
          canSelect={canSelect}
          selected={selected}
          onSelect={setSelected}
          onPreview={setPreviewIid}
        />
        <CardInspector def={inspectedDef} />
      </main>

      <footer className="logbar">
        {state.log.slice(-6).map((e, i) => (
          <span key={i} className="logline">{describe(e)}</span>
        ))}
      </footer>
    </div>
  );
}

function PlayerSide(props: {
  label: string;
  who: Seat;
  state: GameState;
  def: (iid: string) => CardDef;
  viewer: Seat | "spectator";
  canSelect: (iid: string) => boolean;
  selected: string | null;
  onSelect: (iid: string) => void;
  onPreview: (iid: string | null) => void;
  flip?: boolean;
}) {
  const { label, who, state, def, viewer, canSelect, selected, onSelect, onPreview, flip } = props;
  const p = state.players[who];
  const zones = (
    <>
      <Zone name={`Front Line (${p.frontLine.length}/4)`} kind="front">
        {p.frontLine.map((iid) => (
          <Card key={iid} iid={iid} inst={state.instances[iid]!} def={def(iid)}
            variant="field"
            selectable={canSelect(iid)} selected={selected === iid} onSelect={onSelect} onPreview={onPreview} />
        ))}
      </Zone>
      <Zone name={`Energy Line (${p.energyLine.length}/4)`} kind="energy">
        {p.energyLine.map((iid) => (
          <Card key={iid} iid={iid} inst={state.instances[iid]!} def={def(iid)}
            variant="field"
            selectable={canSelect(iid)} selected={selected === iid} onSelect={onSelect} onPreview={onPreview} />
        ))}
      </Zone>
    </>
  );

  return (
    <section className={`side ${who}`}>
      <div className="side-head">
        <h2>{label} <span className="tag">{who}</span></h2>
      <div className="counts">
          <span>✋ {p.hand.length}</span>
          <span>❤️ {p.life.length}</span>
          <span>🂠 {p.deck.length}</span>
          <span>⛔ {p.removal.length}</span>
          <span>🪦 {p.sideline.length}</span>
        </div>
      </div>
      <ApStrip state={state} who={who} />
      {flip ? <>{zones}</> : <>{zones}</>}
      <Zone name={flip ? "Hand (hidden)" : `Your Hand (${p.hand.length})`} kind={flip ? "hiddenHand" : "hand"}>
        {flip
          ? p.hand.map((iid) => <div key={iid} className="card facedown" />)
          : p.hand.map((iid) => (
              <Card key={iid} iid={iid} inst={state.instances[iid]!} def={def(iid)}
                variant="hand"
                unplayable={viewer === who && state.phase === "main" && !canPayForCard(state, who, def(iid))}
                selectable={canSelect(iid)} selected={selected === iid} onSelect={onSelect} onPreview={onPreview} />
            ))}
      </Zone>
      <div className="side-stacks">
        <StackZone name="Life" count={p.life.length} kind="life">
          {p.life.map((iid) => {
            const inst = state.instances[iid]!;
            return inst.faceUp ? (
              <Card key={iid} iid={iid} inst={inst} def={def(iid)}
                variant="field"
                selectable={canSelect(iid)} selected={selected === iid} onSelect={onSelect} onPreview={onPreview} />
            ) : (
              <button key={iid} type="button" className="card facedown mini" aria-label="Face-down life card" />
            );
          })}
        </StackZone>
        <StackZone name="Deck" count={p.deck.length} kind="deck">
          {p.deck.length > 0 && <div className="card facedown stack-card" />}
        </StackZone>
        <StackZone name="Removal" count={p.removal.length} kind="removal">
          {p.removal.map((iid) => (
            <Card key={iid} iid={iid} inst={state.instances[iid]!} def={def(iid)}
              variant="field"
              selectable={false} selected={false} onSelect={onSelect} onPreview={onPreview} />
          ))}
        </StackZone>
        <StackZone name="Sideline" count={p.sideline.length} kind="sideline">
          {p.sideline.map((iid) => (
            <Card key={iid} iid={iid} inst={state.instances[iid]!} def={def(iid)}
              variant="field"
              selectable={canSelect(iid)} selected={selected === iid} onSelect={onSelect} onPreview={onPreview} />
          ))}
        </StackZone>
      </div>
    </section>
  );
}

function ApStrip(props: { state: GameState; who: Seat }) {
  const { state, who } = props;
  const active = activeApCount(state, who);
  return (
    <div className="ap-strip" aria-label={`${who} AP ${active} of ${state.players[who].ap.length} active`}>
      <div className="ap-summary">
        <span>AP</span>
        <b>{active}/{state.players[who].ap.length}</b>
      </div>
      <div className="ap-pips">
        {state.players[who].ap.map((iid, index) => {
          const ready = state.instances[iid]!.orientation === "active";
          return <span key={iid} className={`ap-pip ${ready ? "ready" : "spent"}`}>{index + 1}</span>;
        })}
      </div>
    </div>
  );
}

function Zone(props: { name: string; children: React.ReactNode; kind?: "front" | "energy" | "hand" | "hiddenHand" | "sideline" }) {
  return (
    <div className={`zone ${props.kind ? `zone-${props.kind}` : ""}`}>
      <div className="zone-label">{props.name}</div>
      <div className="zone-cards">{props.children}</div>
    </div>
  );
}

function StackZone(props: { name: string; count: number; kind: "life" | "deck" | "removal" | "sideline"; children: React.ReactNode }) {
  return (
    <div className={`stack-zone stack-${props.kind}`}>
      <div className="zone-label">{props.name} ({props.count})</div>
      <div className="stack-cards">{props.children}</div>
    </div>
  );
}

function Card(props: {
  iid: string;
  inst: CardInstance;
  def: CardDef;
  variant: "field" | "hand";
  unplayable?: boolean;
  selectable: boolean;
  selected: boolean;
  onSelect: (iid: string) => void;
  onPreview: (iid: string | null) => void;
}) {
  const { iid, inst, def, variant, unplayable, selectable, selected, onSelect, onPreview } = props;
  return (
    <button
      type="button"
      className={`card card-${variant} ${selected ? "sel" : ""} ${inst.orientation} ${selectable ? "can" : ""} ${unplayable ? "unplayable" : ""}`}
      aria-disabled={!selectable}
      onClick={() => selectable && onSelect(iid)}
      onFocus={() => onPreview(iid)}
      onMouseEnter={() => onPreview(iid)}
      onMouseLeave={() => onPreview(null)}
      title={def.text}
    >
      {def.imageUrl ? (
        <img className="card-art" src={def.imageUrl} alt={`${def.id} ${def.name}`} />
      ) : (
        <div className="card-no-art">
          <div className="card-name">{def.name}</div>
          <div className="card-stats">
            {def.bp != null && <span className="bp">BP {def.bp + (inst.bpModifier ?? 0)}</span>}
            <span className={`dot ${def.color}`} />
          </div>
        </div>
      )}
      {variant === "field" && (
        <div className="field-chip">
          <span>{def.name}</span>
          {def.bp != null && <b>{def.bp + (inst.bpModifier ?? 0)}</b>}
        </div>
      )}
      {variant === "hand" && (
        <div className="hand-chip">
          <span>AP {def.apCost}</span>
          {def.bp != null && <span>BP {def.bp + (inst.bpModifier ?? 0)}</span>}
          {def.hasTrigger && <span>{def.triggerType}</span>}
        </div>
      )}
    </button>
  );
}

function energyText(spec: CardDef["requiredEnergy"]): string {
  if (spec.length === 0) return "0";
  return spec.map((e) => `${e.amount} ${e.color}`).join(", ");
}

function CardInspector(props: { def: CardDef | null }) {
  const { def } = props;
  if (!def) {
    return (
      <aside className="inspector empty">
        <div className="inspector-placeholder">Hover or select a card</div>
      </aside>
    );
  }

  return (
    <aside className="inspector">
      <div className="inspect-media">
        {def.imageUrl ? (
          <img src={def.imageUrl} alt={`${def.id} ${def.name}`} />
        ) : (
          <div className="image-missing">No image</div>
        )}
      </div>
      <div className="inspect-body">
        <div className="inspect-title">
          <span>{def.name}</span>
          <span className={`dot ${def.color}`} />
        </div>
        <div className="inspect-number">{def.id}</div>
        <div className="inspect-grid">
          <span>Type</span><b>{def.type}</b>
          <span>Req</span><b>{energyText(def.requiredEnergy)}</b>
          <span>AP</span><b>{def.apCost}</b>
          {def.bp != null && <><span>BP</span><b>{def.bp}</b></>}
          {def.energyGeneration.length > 0 && <><span>Gen</span><b>{energyText(def.energyGeneration)}</b></>}
        </div>
        {(def.keywords.length > 0 || def.hasTrigger) && (
          <div className="inspect-tags">
            {def.keywords.map((kw) => <span key={kw}>{kw}</span>)}
            {def.hasTrigger && <span>{def.triggerType} trigger</span>}
          </div>
        )}
        {def.text && <p className="inspect-text">{def.text}</p>}
      </div>
    </aside>
  );
}

function Center(props: { children: React.ReactNode }) {
  return <div className="center">{props.children}</div>;
}

function describe(e: GameState["log"][number]): string {
  return (e as { kind?: string }).kind ?? JSON.stringify(e).slice(0, 60);
}
