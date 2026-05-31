import { useState } from "react";
import type { CardDef, CardInstance, GameState, Seat } from "@union-arena/core";
import { useGame } from "./useGame.js";

const ROOM = new URLSearchParams(location.search).get("room") ?? "demo";

export function App() {
  const { connected, seat, state, error, send } = useGame(ROOM);
  const [selected, setSelected] = useState<string | null>(null);

  if (!connected) return <Center>Connecting to server…</Center>;
  if (!state || seat == null) return <Center>Joining room “{ROOM}”…</Center>;

  const me: Seat = seat === "spectator" ? "p1" : seat;
  const opp: Seat = me === "p1" ? "p2" : "p1";
  const myTurn = seat !== "spectator" && state.activeSeat === seat;
  const def = (iid: string): CardDef => state.defs[state.instances[iid]!.defId]!;

  const act = (fn: () => void) => {
    fn();
    setSelected(null);
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">⚔️ Union Arena</div>
        <div className="meta">
          <span>Room <b>{ROOM}</b></span>
          <span>You are <b className={`seat ${seat}`}>{seat}</b></span>
          <span>Turn <b>{state.turn}</b></span>
          <span>Phase <b className="phase">{state.phase}</b></span>
          <span className={myTurn ? "turn-on" : "turn-off"}>
            {state.winner
              ? `🏆 ${state.winner} wins (${state.reason})`
              : myTurn ? "● your turn" : `waiting on ${state.activeSeat}`}
          </span>
        </div>
      </header>

      {error && <div className="error">⚠ {error}</div>}

      <main className="board">
        <PlayerSide
          label="Opponent"
          who={opp}
          state={state}
          def={def}
          selectable={false}
          selected={selected}
          onSelect={() => {}}
          flip
        />

        <div className="midline">
          {myTurn && !state.winner && (
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
                  <button onClick={() => act(() => send({ type: "playCard", seat: me, iid: selected, to: "frontLine" }))}>
                    Play → Front Line
                  </button>
                  <button onClick={() => act(() => send({ type: "playCard", seat: me, iid: selected, to: "energyLine" }))}>
                    Play → Energy Line
                  </button>
                </>
              )}
              {selected && state.phase === "attack" && (
                <button onClick={() => act(() => send({ type: "declareAttack", seat: me, attackerIid: selected }))}>
                  Attack with selected
                </button>
              )}
            </div>
          )}
        </div>

        <PlayerSide
          label="You"
          who={me}
          state={state}
          def={def}
          selectable={myTurn}
          selected={selected}
          onSelect={setSelected}
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
  selectable: boolean;
  selected: string | null;
  onSelect: (iid: string) => void;
  flip?: boolean;
}) {
  const { label, who, state, def, selectable, selected, onSelect, flip } = props;
  const p = state.players[who];
  const zones = (
    <>
      <Zone name={`Front Line (${p.frontLine.length}/4)`}>
        {p.frontLine.map((iid) => (
          <Card key={iid} iid={iid} inst={state.instances[iid]!} def={def(iid)}
            selectable={selectable} selected={selected === iid} onSelect={onSelect} />
        ))}
      </Zone>
      <Zone name={`Energy Line (${p.energyLine.length}/4)`}>
        {p.energyLine.map((iid) => (
          <Card key={iid} iid={iid} inst={state.instances[iid]!} def={def(iid)}
            selectable={false} selected={false} onSelect={onSelect} />
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
          <span>⚡ {p.ap.length}</span>
          <span>🪦 {p.sideline.length}</span>
        </div>
      </div>
      {flip ? <>{zones}</> : <>{zones}</>}
      <Zone name={flip ? "Hand (hidden)" : `Your Hand (${p.hand.length})`}>
        {flip
          ? p.hand.map((iid) => <div key={iid} className="card facedown" />)
          : p.hand.map((iid) => (
              <Card key={iid} iid={iid} inst={state.instances[iid]!} def={def(iid)}
                selectable={selectable} selected={selected === iid} onSelect={onSelect} />
            ))}
      </Zone>
    </section>
  );
}

function Zone(props: { name: string; children: React.ReactNode }) {
  return (
    <div className="zone">
      <div className="zone-label">{props.name}</div>
      <div className="zone-cards">{props.children}</div>
    </div>
  );
}

function Card(props: {
  iid: string;
  inst: CardInstance;
  def: CardDef;
  selectable: boolean;
  selected: boolean;
  onSelect: (iid: string) => void;
}) {
  const { iid, inst, def, selectable, selected, onSelect } = props;
  return (
    <button
      className={`card ${selected ? "sel" : ""} ${inst.orientation} ${selectable ? "can" : ""}`}
      onClick={() => selectable && onSelect(iid)}
      disabled={!selectable}
      title={def.text}
    >
      <div className="card-name">{def.name}</div>
      <div className="card-stats">
        {def.bp != null && <span className="bp">BP {def.bp + (inst.bpModifier ?? 0)}</span>}
        <span className={`dot ${def.color}`} />
      </div>
      {def.hasTrigger && <div className="trig">⟡ {def.triggerType}</div>}
    </button>
  );
}

function Center(props: { children: React.ReactNode }) {
  return <div className="center">{props.children}</div>;
}

function describe(e: GameState["log"][number]): string {
  return (e as { kind?: string }).kind ?? JSON.stringify(e).slice(0, 60);
}
