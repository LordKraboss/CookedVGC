// game/DraftBoard.jsx
// Presentational board for the Draft mode. Knows nothing about local vs room —
// it just renders `state` and calls `dispatch`. Driven entirely by props from
// useGameRoom, so the same component serves pass-and-play and networked rooms.

import { PokemonImage } from '../components/PokemonCard';
import { totalPicks, poolTarget } from './modes/draft';

const PLAYER_COLORS = ['#60a5fa', '#f97316', '#4ade80', '#f472b6', '#a78bfa', '#fbbf24', '#22d3ee', '#fb7185'];
const colorFor = i => PLAYER_COLORS[i % PLAYER_COLORS.length];

// ── Roster panel (one per player) ──────────────────────────────────────────────
function RosterPanel({ player, picks, slots, active, isYou }) {
  const color = colorFor(player.index);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{
        padding: '8px 12px', borderRadius: 8, textAlign: 'center',
        border: `1px solid ${active ? color : 'var(--border)'}`,
        background: active ? `color-mix(in srgb, ${color} 12%, transparent)` : 'var(--bg1)',
        transition: 'border-color .2s, background .2s',
      }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: active ? color : 'var(--text-muted)' }}>
          {player.name}{isYou ? ' (you)' : ''}{player.isHost ? ' ★' : ''}
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
          {picks.length} / {slots} picks
        </div>
      </div>
      {picks.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {picks.map(p => (
            <div key={p.name} title={p.name} style={{
              padding: '3px 7px', borderRadius: 5, background: 'var(--bg2)',
              border: '1px solid var(--border)', fontSize: 10, fontWeight: 700,
              color: 'var(--text-secondary)',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {p.name}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Pool card (imperative hover — no re-render on scroll) ───────────────────────
function PoolCard({ pokemon, onClick, disabled, hoverColor = 'var(--accent)' }) {
  return (
    <div
      onClick={disabled ? undefined : onClick}
      onMouseEnter={e => {
        if (disabled) return;
        e.currentTarget.style.borderColor = hoverColor;
        e.currentTarget.style.background  = `color-mix(in srgb, ${hoverColor} 9%, var(--bg1))`;
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = 'var(--border)';
        e.currentTarget.style.background  = 'var(--bg1)';
      }}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        padding: '10px 6px', borderRadius: 10, gap: 4,
        border: '1px solid var(--border)', background: 'var(--bg1)',
        cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.55 : 1,
        userSelect: 'none',
      }}
    >
      <PokemonImage name={pokemon.name} spriteUrl={pokemon.spriteUrl} size={64} />
      <span style={{
        fontSize: 10, fontWeight: 700, color: 'var(--text-secondary)',
        textAlign: 'center', lineHeight: 1.2, maxWidth: 80,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>
        {pokemon.name}
      </span>
    </div>
  );
}

// ── Board ───────────────────────────────────────────────────────────────────────
export default function DraftBoard({
  game,            // from useGameRoom
  transport,       // 'local' | 'room'
  roomCode,        // for room mode
  onExit,          // back to lobby
}) {
  const { state, dispatch, restart, players, myIndex, myTurn, isHost } = game;

  if (!state) {
    return (
      <div style={{ textAlign: 'center', padding: '80px 20px', color: 'var(--text-muted)' }}>
        Waiting for the host to start…
      </div>
    );
  }

  const canControlPrep = isHost; // host (or local single-screen) controls setup
  const slots = state.config.picksPerPlayer;

  // ── PREP ──────────────────────────────────────────────────────────────────────
  if (state.phase === 'prep') {
    return (
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        <BoardHeader transport={transport} roomCode={roomCode} players={players} myIndex={myIndex} onExit={onExit}
          title="Preparation"
          subtitle={canControlPrep
            ? "Click any Pokémon to swap it for a random replacement, then begin."
            : "The host is setting up the pool…"} />

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))', gap: 8 }}>
          {state.pool.map(p => (
            <PoolCard
              key={p.name}
              pokemon={p}
              hoverColor="#f87171"
              disabled={!canControlPrep || state.bench.length === 0}
              onClick={() => dispatch({ type: 'reroll', name: p.name })}
            />
          ))}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16 }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {state.bench.length} Pokémon available for swaps · {state.config.players} players × {slots} picks
          </span>
          {canControlPrep && (
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={restart} style={btnGhost}>Reroll all</button>
              <button onClick={() => dispatch({ type: 'beginDraft' })} style={btnPrimary}>Begin Draft →</button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── DONE ────────────────────────────────────────────────────────────────────────
  if (state.phase === 'done') {
    return (
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <BoardHeader transport={transport} roomCode={roomCode} players={players} myIndex={myIndex} onExit={onExit}
          title="Draft complete" subtitle={null}
          right={isHost && <button onClick={restart} style={btnPrimary}>New Draft</button>} />
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(players.length, 3)}, 1fr)`, gap: 20 }}>
          {players.map(pl => (
            <div key={pl.index}>
              <div style={{ fontSize: 14, fontWeight: 800, color: colorFor(pl.index), marginBottom: 12 }}>
                {pl.name}{pl.index === myIndex ? ' (you)' : ''}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                {(state.picks[pl.index] ?? []).map(p => (
                  <div key={p.name} style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                    padding: '10px 6px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg1)',
                  }}>
                    <PokemonImage name={p.name} spriteUrl={p.spriteUrl} size={56} />
                    <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-secondary)', textAlign: 'center' }}>{p.name}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── DRAFTING ──────────────────────────────────────────────────────────────────
  const turnColor = colorFor(state.turn);
  const turnPlayer = players.find(p => p.index === state.turn);
  const yourTurnLabel = transport === 'room'
    ? (myTurn ? 'Your turn to pick' : `Waiting for ${turnPlayer?.name ?? `Player ${state.turn + 1}`}…`)
    : `${turnPlayer?.name ?? `Player ${state.turn + 1}`}'s turn to pick`;

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 20px', borderRadius: 10, marginBottom: 20,
        border: `1px solid ${turnColor}`, background: `color-mix(in srgb, ${turnColor} 8%, var(--bg1))`,
      }}>
        <span style={{ fontSize: 16, fontWeight: 800, color: turnColor }}>{yourTurnLabel}</span>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {totalPicks(state)} / {poolTarget(state)} picked
        </span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {transport === 'room' && <RoomTag code={roomCode} />}
          {isHost && <button onClick={restart} style={btnSmall}>Reset</button>}
          <button onClick={onExit} style={btnSmall}>Exit</button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        {/* Rosters */}
        <div style={{ width: 210, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {players.map(pl => (
            <RosterPanel
              key={pl.index}
              player={pl}
              picks={state.picks[pl.index] ?? []}
              slots={slots}
              active={state.turn === pl.index}
              isYou={pl.index === myIndex}
            />
          ))}
        </div>

        {/* Pool */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.08em', color: 'var(--text-muted)', marginBottom: 10 }}>
            AVAILABLE — {state.pool.length} remaining
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))', gap: 8 }}>
            {state.pool.map(p => (
              <PoolCard
                key={p.name}
                pokemon={p}
                hoverColor={turnColor}
                disabled={!myTurn}
                onClick={() => dispatch({ type: 'pick', name: p.name })}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Shared bits ─────────────────────────────────────────────────────────────────
function RoomTag({ code }) {
  return (
    <span style={{
      fontSize: 11, fontWeight: 800, fontFamily: 'var(--mono)', letterSpacing: '.1em',
      padding: '4px 10px', borderRadius: 6,
      background: 'color-mix(in srgb, var(--accent) 12%, transparent)',
      color: 'var(--accent)', border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)',
    }}>
      {code}
    </span>
  );
}

function BoardHeader({ title, subtitle, right, transport, roomCode, players, myIndex, onExit }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20, gap: 12 }}>
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 4 }}>{title}</h1>
        {subtitle && <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>{subtitle}</p>}
        {transport === 'room' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
            <RoomTag code={roomCode} />
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              {players.length} in room · you are {players.find(p => p.index === myIndex)?.name}
            </span>
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        {right}
        <button onClick={onExit} style={btnSmall}>Exit</button>
      </div>
    </div>
  );
}

const btnPrimary = {
  padding: '8px 24px', borderRadius: 8, fontSize: 13, fontWeight: 800, cursor: 'pointer',
  border: '1px solid var(--accent)', background: 'color-mix(in srgb, var(--accent) 15%, transparent)', color: 'var(--accent)',
};
const btnGhost = {
  padding: '8px 18px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer',
  border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text-muted)',
};
const btnSmall = {
  padding: '6px 14px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer',
  border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text-muted)',
};
