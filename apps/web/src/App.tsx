import { type DragEvent, type FormEvent, useState } from "react";
import type { CardDef, CardInstance, Color, GameState, Seat } from "@union-arena/core";
import { EFFECTS, playerTurnNumber } from "@union-arena/core";
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
  const pool = energyPool(state, seat);
  return card.requiredEnergy.every((energy) => pool[energy.color] >= energy.amount);
}

const COLORS: Color[] = ["red", "blue", "green", "yellow", "purple"];

function energyPool(state: GameState, seat: Seat): Record<Color, number> {
  const pool: Record<Color, number> = { red: 0, blue: 0, green: 0, yellow: 0, purple: 0 };
  for (const iid of state.players[seat].energyLine) {
    const def = state.defs[state.instances[iid]!.defId]!;
    for (const energy of def.energyGeneration) {
      pool[energy.color] += energy.amount;
    }
  }
  return pool;
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
  const [lifeDamageTargets, setLifeDamageTargets] = useState<string[]>([]);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  const [previewIid, setPreviewIid] = useState<string | null>(null);
  const [draggedIid, setDraggedIid] = useState<string | null>(null);

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
  const canRespondToAttack = seat !== "spectator" && pendingAttack != null && seat === defender;
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
    setLifeDamageTargets([]);
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
  const pendingAttackerDef = pendingAttack ? def(pendingAttack.attackerIid) : null;
  const pendingAttackCanDamageLife =
    Boolean(pendingAttack && pendingAttack.targetIid == null && pendingAttackerDef);
  const pendingLifeDamageAmount = pendingAttackerDef
    ? Math.min(Math.max(1, pendingAttackerDef.impactN ?? 1), state.players[me].life.length)
    : 0;
  const pendingAttackRequiresLifeTarget =
    canRespondToAttack &&
    pendingAttackCanDamageLife &&
    state.players[me].life.length > 0;
  const selectedLifeDamageTargets =
    seat !== "spectator" ? lifeDamageTargets.filter((iid) => state.players[seat].life.includes(iid)) : [];
  const lifeDamagePayload =
    pendingAttackRequiresLifeTarget && selectedLifeDamageTargets.length > 0 ? { lifeIids: selectedLifeDamageTargets } : {};
  const canTakeLifeDamage = !pendingAttackRequiresLifeTarget || selectedLifeDamageTargets.length === pendingLifeDamageAmount;
  const selectedBlockerHasRequiredLifeTarget =
    !selectedCanBlock ||
    !pendingAttackerDef?.keywords.includes("impact") ||
    !pendingAttackRequiresLifeTarget ||
    selectedLifeDamageTargets.length === pendingLifeDamageAmount;
  const chooseLifeDamageTarget = (iid: string) => {
    setLifeDamageTargets((current) => {
      if (pendingLifeDamageAmount <= 1) return [iid];
      if (current.includes(iid)) return current.filter((target) => target !== iid);
      if (current.length >= pendingLifeDamageAmount) return [...current.slice(1), iid];
      return [...current, iid];
    });
  };

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

  const canDrag = (iid: string): boolean => {
    if (seat === "spectator" || !canUseTurnActions || !canSelect(iid)) return false;
    const p = state.players[me];
    if (state.phase === "main") return p.hand.includes(iid);
    if (state.phase === "movement") return p.frontLine.includes(iid) || p.energyLine.includes(iid);
    return false;
  };

  const canDropTo = (target: "frontLine" | "energyLine", iid = draggedIid): boolean => {
    if (!iid || seat === "spectator" || !canUseTurnActions) return false;
    const p = state.players[me];
    if (state.phase === "main") return p.hand.includes(iid) && canPayForCard(state, me, def(iid));
    if (state.phase !== "movement") return false;
    if (target === "frontLine") return p.energyLine.includes(iid);
    return p.frontLine.includes(iid);
  };

  const dropTo = (target: "frontLine" | "energyLine", iid: string) => {
    if (!canDropTo(target, iid)) return;
    const p = state.players[me];
    if (state.phase === "main" && p.hand.includes(iid)) {
      act(() => send({ type: "playCard", seat: me, iid, to: target }));
      return;
    }
    if (state.phase === "movement" && (p.frontLine.includes(iid) || p.energyLine.includes(iid))) {
      act(() => send({ type: "move", seat: me, iid, to: target }));
    }
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
          <span>{state.activeSeat} turn <b>{playerTurnNumber(state.activeSeat, state.turn)}</b></span>
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
          canDrag={canDrag}
          onDragStart={setDraggedIid}
          onDragEnd={() => setDraggedIid(null)}
          canDropTo={() => false}
          onDropTo={() => {}}
          lifeDamageTargets={lifeDamageTargets}
          canChooseLifeDamageTarget={false}
          onLifeDamageTarget={chooseLifeDamageTarget}
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
                <button
                  disabled={!selectedBlockerHasRequiredLifeTarget}
                  onClick={() => act(() => send({ type: "declareBlock", seat: me, blockerIid: selected, ...lifeDamagePayload }))}
                >
                  Block with selected
                </button>
              )}
              {pendingAttackRequiresLifeTarget && (
                <span>
                  {selectedLifeDamageTargets.length === pendingLifeDamageAmount
                    ? "Life target selected."
                    : `Choose ${pendingLifeDamageAmount} life card${pendingLifeDamageAmount === 1 ? "" : "s"} for damage.`}
                </span>
              )}
              <button
                disabled={!canTakeLifeDamage}
                onClick={() => act(() => send({ type: "declareBlock", seat: me, ...lifeDamagePayload }))}
              >
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
                Next Phase
              </button>
              <button onClick={() => act(() => send({ type: "endTurn", seat: me }))}>
                End Turn
              </button>
              {state.phase === "start" && (
                <button onClick={() => act(() => send({ type: "extraDraw", seat: me }))}>
                  Draw (1 AP)
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

          <CardInspector def={inspectedDef} />
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
          canDrag={canDrag}
          onDragStart={setDraggedIid}
          onDragEnd={() => setDraggedIid(null)}
          canDropTo={(target) => canDropTo(target)}
          onDropTo={(target, iid) => dropTo(target, iid)}
          lifeDamageTargets={lifeDamageTargets}
          canChooseLifeDamageTarget={pendingAttackRequiresLifeTarget}
          onLifeDamageTarget={chooseLifeDamageTarget}
        />
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
  canDrag: (iid: string) => boolean;
  onDragStart: (iid: string) => void;
  onDragEnd: () => void;
  canDropTo: (target: "frontLine" | "energyLine") => boolean;
  onDropTo: (target: "frontLine" | "energyLine", iid: string) => void;
  lifeDamageTargets: string[];
  canChooseLifeDamageTarget: boolean;
  onLifeDamageTarget: (iid: string) => void;
  flip?: boolean;
}) {
  const {
    label,
    who,
    state,
    def,
    viewer,
    canSelect,
    selected,
    onSelect,
    onPreview,
    canDrag,
    onDragStart,
    onDragEnd,
    canDropTo,
    onDropTo,
    lifeDamageTargets,
    canChooseLifeDamageTarget,
    onLifeDamageTarget,
    flip,
  } = props;
  const p = state.players[who];
  const energy = energyPool(state, who);
  const zones = (
    <>
      <Zone
        name={`Front Line (${p.frontLine.length}/4)`}
        kind="front"
        dropTarget="frontLine"
        canDrop={canDropTo("frontLine")}
        onDropTo={onDropTo}
      >
        {p.frontLine.map((iid) => (
          <Card key={iid} iid={iid} inst={state.instances[iid]!} def={def(iid)}
            variant="field"
            selectable={canSelect(iid)} selected={selected === iid} draggable={canDrag(iid)}
            onSelect={onSelect} onPreview={onPreview} onDragStart={onDragStart} onDragEnd={onDragEnd} />
        ))}
      </Zone>
      <Zone
        name={`Energy Line (${p.energyLine.length}/4) · ${energySummary(energy)}`}
        kind="energy"
        dropTarget="energyLine"
        canDrop={canDropTo("energyLine")}
        onDropTo={onDropTo}
      >
        {p.energyLine.map((iid) => (
          <Card key={iid} iid={iid} inst={state.instances[iid]!} def={def(iid)}
            variant="field"
            selectable={canSelect(iid)} selected={selected === iid} draggable={canDrag(iid)}
            onSelect={onSelect} onPreview={onPreview} onDragStart={onDragStart} onDragEnd={onDragEnd} />
        ))}
      </Zone>
    </>
  );

  return (
    <section className={`side ${who} ${flip ? "opponent-side" : "player-side"}`}>
      <div className="side-head">
        <h2>{label} <span className="tag">{who}</span></h2>
        <div className="counts">
          <span>✋ {p.hand.length}</span>
          <span>❤️ {p.life.length}</span>
          <span>🂠 {p.deck.length}</span>
          <span>⛔ {p.removal.length}</span>
          <span>🪦 {p.sideline.length}</span>
        </div>
        <EnergyStrip pool={energy} />
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
                selectable={canSelect(iid)} selected={selected === iid} draggable={canDrag(iid)}
                onSelect={onSelect} onPreview={onPreview} onDragStart={onDragStart} onDragEnd={onDragEnd} />
            ))}
      </Zone>
      <div className="side-stacks">
        <StackZone name="Life" count={p.life.length} kind="life">
          {p.life.map((iid) => {
            const inst = state.instances[iid]!;
            const lifeSelected = lifeDamageTargets.includes(iid);
            return inst.faceUp ? (
              <Card key={iid} iid={iid} inst={inst} def={def(iid)}
                variant="field"
                selectable={canChooseLifeDamageTarget || canSelect(iid)}
                selected={lifeSelected || selected === iid}
                draggable={canDrag(iid)}
                onSelect={canChooseLifeDamageTarget ? onLifeDamageTarget : onSelect}
                onPreview={onPreview}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd} />
            ) : (
              <button
                key={iid}
                type="button"
                className={`card facedown mini life-card ${canChooseLifeDamageTarget ? "can" : ""} ${lifeSelected ? "sel" : ""}`}
                aria-label={canChooseLifeDamageTarget ? "Choose this life card for damage" : "Face-down life card"}
                onClick={() => canChooseLifeDamageTarget && onLifeDamageTarget(iid)}
              />
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
              selectable={false} selected={false} draggable={false}
              onSelect={onSelect} onPreview={onPreview} onDragStart={onDragStart} onDragEnd={onDragEnd} />
          ))}
        </StackZone>
        <StackZone name="Sideline" count={p.sideline.length} kind="sideline">
          {p.sideline.map((iid) => (
            <Card key={iid} iid={iid} inst={state.instances[iid]!} def={def(iid)}
              variant="field"
              selectable={canSelect(iid)} selected={selected === iid} draggable={canDrag(iid)}
              onSelect={onSelect} onPreview={onPreview} onDragStart={onDragStart} onDragEnd={onDragEnd} />
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

function energySummary(pool: Record<Color, number>): string {
  const parts = COLORS.filter((color) => pool[color] > 0).map((color) => `${pool[color]} ${color}`);
  return parts.length > 0 ? parts.join(", ") : "0 energy";
}

function EnergyStrip(props: { pool: Record<Color, number> }) {
  const generatedColors = COLORS.filter((color) => props.pool[color] > 0);
  return (
    <div className="energy-strip" aria-label={`Energy generation ${energySummary(props.pool)}`}>
      <span className="energy-label">Energy</span>
      {generatedColors.length === 0 ? (
        <b className="energy-empty">0</b>
      ) : (
        generatedColors.map((color) => (
          <span key={color} className={`energy-chip ${color}`}>
            <span className={`dot ${color}`} />
            <b>{props.pool[color]}</b>
          </span>
        ))
      )}
    </div>
  );
}

function Zone(props: {
  name: string;
  children: React.ReactNode;
  kind?: "front" | "energy" | "hand" | "hiddenHand" | "sideline";
  dropTarget?: "frontLine" | "energyLine";
  canDrop?: boolean;
  onDropTo?: (target: "frontLine" | "energyLine", iid: string) => void;
}) {
  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!props.dropTarget || !props.canDrop) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!props.dropTarget || !props.canDrop || !props.onDropTo) return;
    event.preventDefault();
    const iid = event.dataTransfer.getData("text/plain");
    if (iid) props.onDropTo(props.dropTarget, iid);
  };

  return (
    <div className={`zone ${props.kind ? `zone-${props.kind}` : ""} ${props.dropTarget ? "zone-drop" : ""} ${props.canDrop ? "can-drop" : ""}`}>
      <div className="zone-label">{props.name}</div>
      <div className="zone-cards" onDragOver={onDragOver} onDrop={onDrop}>{props.children}</div>
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
  draggable: boolean;
  onSelect: (iid: string) => void;
  onPreview: (iid: string | null) => void;
  onDragStart: (iid: string) => void;
  onDragEnd: () => void;
}) {
  const { iid, inst, def, variant, unplayable, selectable, selected, draggable, onSelect, onPreview, onDragStart, onDragEnd } = props;
  return (
    <button
      type="button"
      className={`card card-${variant} ${selected ? "sel" : ""} ${inst.orientation} ${selectable ? "can" : ""} ${draggable ? "can-drag" : ""} ${unplayable ? "unplayable" : ""}`}
      aria-disabled={!selectable}
      draggable={draggable}
      onClick={() => selectable && onSelect(iid)}
      onFocus={() => onPreview(iid)}
      onMouseEnter={() => onPreview(iid)}
      onMouseLeave={() => onPreview(null)}
      onDragStart={(event) => {
        if (!draggable) return;
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", iid);
        onDragStart(iid);
      }}
      onDragEnd={onDragEnd}
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
        <>
          {def.bp != null && <div className="field-bp-badge">BP {def.bp + (inst.bpModifier ?? 0)}</div>}
          <div className="field-chip">
            <span>{def.name}</span>
          </div>
        </>
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
    <aside className={`inspector ${def.text ? "has-text" : ""}`}>
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
