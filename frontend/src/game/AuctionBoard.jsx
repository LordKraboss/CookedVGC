// game/AuctionBoard.jsx
// Presentational board for Auction mode. Transport-agnostic — driven entirely by
// props from useGameRoom. Works for both pass-and-play and networked rooms.
//
// Timer model: state stores { startedAt } timestamps. Every client computes
// remaining time locally from Date.now() for smooth display. Only the HOST
// dispatches selectionTimeout / bidTimeout when their local timer fires.

import { useEffect, useRef, useState } from 'react';
import { PokemonImage } from '../components/PokemonCard';
import { playWinChime, playTurnChime, playWarningChime } from './sound';

const PD = '₽'; // Pokédollar symbol
const PLAYER_COLORS = [
  '#60a5fa', '#f97316', '#4ade80', '#f472b6',
  '#a78bfa', '#fbbf24', '#22d3ee', '#fb7185',
  '#34d399', '#f59e0b', '#818cf8', '#f43f5e',
  '#38bdf8', '#a3e635', '#c084fc', '#fb923c',
];
const colorFor = i => PLAYER_COLORS[i % PLAYER_COLORS.length];

// ── Countdown hook ──────────────────────────────────────────────────────────────
function useCountdown(startedAt, durationMs) {
  const [remaining, setRemaining] = useState(null);
  useEffect(() => {
    if (startedAt == null || !durationMs) { setRemaining(null); return; }
    const tick = () => {
      setRemaining(Math.max(0, Math.ceil((startedAt + durationMs - Date.now()) / 1000)));
    };
    tick();
    const id = setInterval(tick, 200);
    return () => clearInterval(id);
  }, [startedAt, durationMs]);
  return remaining;
}

// ── Countdown ring ──────────────────────────────────────────────────────────────
function CountdownRing({ remaining, total, color, size = 72 }) {
  if (remaining === null) return null;
  const r = (size - 10) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - Math.max(0, remaining) / (total || 1));
  const urgent = remaining <= 5;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0 }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border)" strokeWidth={5} />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke={urgent ? '#f87171' : color}
        strokeWidth={5}
        strokeDasharray={circ}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: 'stroke-dashoffset .2s linear, stroke .3s' }}
      />
      <text x={size / 2} y={size / 2 + 6} textAnchor="middle"
        fontSize={size < 60 ? 14 : 20} fontWeight={800}
        fill={urgent ? '#f87171' : 'var(--text-primary)'}>
        {remaining}
      </text>
    </svg>
  );
}

// ── Player sidebar row ──────────────────────────────────────────────────────────
function PlayerRow({ player, money, team, picksPerPlayer, isYou, isNominator, isLeader, phase }) {
  const color = colorFor(player.index);
  const picks = team.length;
  const highlighted = (isLeader && phase === 'bidding') || (isNominator && phase === 'selection');
  const badgeColor = isLeader && phase === 'bidding' ? '#fbbf24' : color;
  const badge = isLeader && phase === 'bidding' ? 'LEADING' : isNominator && phase === 'selection' ? 'PICKING' : null;

  return (
    <div style={{
      padding: '9px 12px', borderRadius: 8, transition: 'all .2s',
      border: `1px solid ${highlighted ? badgeColor : 'var(--border)'}`,
      background: highlighted ? `color-mix(in srgb, ${badgeColor} 8%, transparent)` : 'var(--bg1)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
        <span style={{ fontSize: 12, fontWeight: 800, color: highlighted ? badgeColor : 'var(--text-primary)' }}>
          {player.name}{isYou ? ' (you)' : ''}{player.isHost ? ' ★' : ''}
        </span>
        {badge && (
          <span style={{ fontSize: 9, fontWeight: 800, color: badgeColor, letterSpacing: '.06em' }}>{badge}</span>
        )}
      </div>
      <div style={{ display: 'flex', gap: 10, fontSize: 11 }}>
        <span style={{ color: money === 0 ? '#f87171' : 'var(--text-secondary)' }}>
          {PD}{money.toLocaleString()}
        </span>
        <span style={{ color: picks >= picksPerPlayer ? '#4ade80' : 'var(--text-muted)' }}>
          {picks}/{picksPerPlayer}
        </span>
      </div>
      {picks > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 6 }}>
          {team.map(p => (
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

// ── Sidebar ─────────────────────────────────────────────────────────────────────
function Sidebar({ state, players, myIndex }) {
  const nominator = state.order[state.nominationTurn];
  const leader    = state.currentBid?.byIndex ?? -1;
  return (
    <div style={{ width: 190, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.08em', color: 'var(--text-muted)', marginBottom: 2 }}>
        PLAYERS
      </div>
      {players.map(pl => (
        <PlayerRow
          key={pl.index}
          player={pl}
          money={state.money[pl.index] ?? 0}
          team={state.picks[pl.index] ?? []}
          picksPerPlayer={state.config.picksPerPlayer}
          isYou={pl.index === myIndex}
          isNominator={pl.index === nominator}
          isLeader={pl.index === leader}
          phase={state.phase}
        />
      ))}
    </div>
  );
}

// ── Pool card ───────────────────────────────────────────────────────────────────
function PoolCard({ pokemon, onClick, disabled, hoverColor, selected }) {
  return (
    <div
      onClick={disabled ? undefined : onClick}
      onMouseEnter={e => {
        if (disabled || selected) return;
        e.currentTarget.style.borderColor = hoverColor;
        e.currentTarget.style.background  = `color-mix(in srgb, ${hoverColor} 9%, var(--bg1))`;
      }}
      onMouseLeave={e => {
        if (selected) return;
        e.currentTarget.style.borderColor = 'var(--border)';
        e.currentTarget.style.background  = 'var(--bg1)';
      }}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        padding: '10px 6px', borderRadius: 10, gap: 4, userSelect: 'none',
        border: `1px solid ${selected ? hoverColor : 'var(--border)'}`,
        background: selected ? `color-mix(in srgb, ${hoverColor} 12%, var(--bg1))` : 'var(--bg1)',
        outline: selected ? `2px solid ${hoverColor}` : 'none', outlineOffset: 1,
        cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1,
        transition: 'border-color .12s, background .12s',
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

// ── Bid row (one per player in local mode, or just current player in room mode) ─
function BidRow({ player, money, minBid, minIncrement, isYou, transport, full, onAuto, onPlace }) {
  const [input, setInput] = useState('');
  const canAuto   = !full && money >= minBid;
  const bidVal    = Number(input);
  const canCustom = !full && input !== '' && !isNaN(bidVal) && bidVal >= minBid && bidVal <= money;
  const color     = colorFor(player.index);

  function submit() {
    if (!canCustom) return;
    onPlace(bidVal);
    setInput('');
  }

  // Reset input when minBid changes (new bid came in)
  const prevMin = useRef(minBid);
  useEffect(() => {
    if (prevMin.current !== minBid) { setInput(''); prevMin.current = minBid; }
  }, [minBid]);

  return (
    <div style={{
      padding: '10px 14px', borderRadius: 8, border: '1px solid var(--border)',
      background: 'var(--bg2)',
    }}>
      {transport === 'local' && (
        <div style={{ fontSize: 11, fontWeight: 800, color, marginBottom: 8 }}>
          {player.name} — {PD}{money.toLocaleString()} remaining
        </div>
      )}
      {transport === 'room' && (
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.08em', color: 'var(--text-muted)', marginBottom: 8 }}>
          YOUR BID — {PD}{money.toLocaleString()} remaining
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {/* Custom amount input + Bid button */}
        <div style={{ display: 'flex', flex: 1, minWidth: 180 }}>
          <span style={{
            padding: '9px 11px', background: 'var(--bg3, var(--bg1))',
            border: '1px solid var(--border)', borderRight: 'none',
            borderRadius: '8px 0 0 8px', fontSize: 13, fontWeight: 700, color: 'var(--text-muted)',
          }}>{PD}</span>
          <input
            type="number" min={minBid} max={money}
            value={input}
            disabled={full}
            placeholder={minBid.toString()}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && submit()}
            style={{
              flex: 1, padding: '9px 10px',
              background: 'var(--bg1)', border: '1px solid var(--border)',
              borderRight: 'none', color: 'var(--text-primary)',
              fontSize: 13, outline: 'none', MozAppearance: 'textfield', borderRadius: 0,
            }}
          />
          <button onClick={submit} disabled={!canCustom} style={{
            padding: '9px 16px', borderRadius: '0 8px 8px 0', fontSize: 13, fontWeight: 800,
            border: `1px solid ${canCustom ? 'var(--accent)' : 'var(--border)'}`,
            background: canCustom ? 'color-mix(in srgb, var(--accent) 15%, transparent)' : 'var(--bg2)',
            color: canCustom ? 'var(--accent)' : 'var(--text-muted)',
            cursor: canCustom ? 'pointer' : 'default', opacity: canCustom ? 1 : 0.55,
          }}>Bid</button>
        </div>
        {/* Auto-bid button */}
        <button onClick={onAuto} disabled={!canAuto} style={{
          padding: '9px 14px', borderRadius: 8, fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap',
          border: '1px solid var(--border)',
          background: canAuto ? 'var(--bg1)' : 'var(--bg2)',
          color: canAuto ? 'var(--text-secondary)' : 'var(--text-muted)',
          cursor: canAuto ? 'pointer' : 'default', opacity: canAuto ? 1 : 0.5,
        }}>
          Auto +{PD}{minIncrement} → {PD}{minBid.toLocaleString()}
        </button>
      </div>
      {full && (
        <div style={{ fontSize: 11, color: '#4ade80', marginTop: 6 }}>
          Team full — can't bid on more Pokémon
        </div>
      )}
      {!full && !canAuto && money > 0 && (
        <div style={{ fontSize: 11, color: '#f87171', marginTop: 6 }}>
          Minimum bid is {PD}{minBid.toLocaleString()} — you only have {PD}{money.toLocaleString()}
        </div>
      )}
      {!full && money === 0 && (
        <div style={{ fontSize: 11, color: '#f87171', marginTop: 6 }}>No money left</div>
      )}
    </div>
  );
}

// ── Selection phase ─────────────────────────────────────────────────────────────
function SelectionPhase({ state, dispatch, players, myIndex, transport, roomCode, onExit }) {
  const nominator     = state.order[state.nominationTurn];
  const nominatorName = players.find(p => p.index === nominator)?.name ?? `Player ${nominator + 1}`;
  const isMyTurn      = transport === 'local' || myIndex === nominator;
  const color         = colorFor(nominator);
  const countdown     = useCountdown(state.selectionTimer?.startedAt, 30_000);
  const [query, setQuery]   = useState('');

  // Warn once when my own pick-timer crosses 5 seconds remaining.
  const warnedRef = useRef(false);
  useEffect(() => {
    if (!isMyTurn || countdown === null) { warnedRef.current = false; return; }
    if (countdown <= 5 && countdown > 0 && !warnedRef.current) {
      warnedRef.current = true;
      playWarningChime();
    }
    if (countdown > 5) warnedRef.current = false;
  }, [countdown, isMyTurn]);

  const q = query.trim().toLowerCase();
  const visiblePool = q
    ? state.pool.filter(p => p.name.toLowerCase().includes(q))
    : state.pool;

  function preselect(name) { dispatch({ type: 'preselectPokemon', name, by: nominator }); }
  function confirm()       { dispatch({ type: 'confirmSelection', by: nominator }); }

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12,
        padding: '12px 20px', borderRadius: 10, marginBottom: 20,
        border: `1px solid ${color}`,
        background: `color-mix(in srgb, ${color} 8%, var(--bg1))`,
      }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 800, color }}>
            {isMyTurn ? 'Your turn to nominate' : `${nominatorName} is choosing…`}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
            {isMyTurn
              ? 'Click a Pokémon to pre-select it, then hit Validate'
              : 'Waiting for nomination…'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <CountdownRing remaining={countdown} total={30} color={color} size={64} />
          {transport === 'room' && <RoomTag code={roomCode} />}
          <button onClick={onExit} style={btnSmall}>Exit</button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        {/* Pool */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 10,
          }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.08em', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
              AVAILABLE — {q ? `${visiblePool.length} of ${state.pool.length}` : `${state.pool.length} remaining`}
            </span>
            <input
              type="text"
              value={query}
              placeholder="Search Pokémon…"
              onChange={e => setQuery(e.target.value)}
              style={{
                flex: 1, maxWidth: 260, padding: '7px 11px', borderRadius: 8,
                background: 'var(--bg1)', border: '1px solid var(--border)',
                color: 'var(--text-primary)', fontSize: 12, outline: 'none',
              }}
            />
            {isMyTurn && state.preSelected && (
              <button onClick={confirm} style={{
                padding: '8px 20px', borderRadius: 8, fontSize: 13, fontWeight: 800, cursor: 'pointer', whiteSpace: 'nowrap',
                border: `1px solid ${color}`,
                background: `color-mix(in srgb, ${color} 15%, transparent)`,
                color,
              }}>
                ✓ Validate: {state.preSelected.name}
              </button>
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))', gap: 8 }}>
            {visiblePool.map(p => (
              <PoolCard
                key={p.name}
                pokemon={p}
                hoverColor={color}
                disabled={!isMyTurn}
                selected={state.preSelected?.name === p.name}
                onClick={() => preselect(p.name)}
              />
            ))}
          </div>
          {q && visiblePool.length === 0 && (
            <div style={{ padding: '24px 0', textAlign: 'center', fontSize: 12, color: 'var(--text-muted)' }}>
              No Pokémon match “{query}”
            </div>
          )}
        </div>

        <Sidebar state={state} players={players} myIndex={myIndex} />
      </div>
    </div>
  );
}

// ── Bidding phase ───────────────────────────────────────────────────────────────
function BiddingPhase({ state, dispatch, players, myIndex, transport, roomCode, onExit }) {
  const { currentBid, currentPokemon, config } = state;
  const minBid      = currentBid.amount + config.minIncrement;
  const leader      = currentBid.byIndex;
  const leaderName  = players.find(p => p.index === leader)?.name ?? `Player ${leader + 1}`;
  const leaderColor = colorFor(leader);
  const nominator   = state.order[state.nominationTurn];
  const nomName     = players.find(p => p.index === nominator)?.name ?? `Player ${nominator + 1}`;
  const countdown   = useCountdown(state.bidTimer?.startedAt, config.auctionTimer * 1000);
  const urgent      = countdown !== null && countdown <= 3;

  // In room mode: only show controls for this client's player
  // In local mode: show controls for ALL players (pass-and-play)
  const biddingPlayers = transport === 'local' ? players : players.filter(p => p.index === myIndex);

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12,
        padding: '12px 20px', borderRadius: 10, marginBottom: 20,
        border: `1px solid ${leaderColor}`,
        background: `color-mix(in srgb, ${leaderColor} 8%, var(--bg1))`,
        transition: 'border-color .3s, background .3s',
      }}>
        <span style={{ fontSize: 16, fontWeight: 800, color: leaderColor }}>
          Auction in progress
        </span>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          {transport === 'room' && <RoomTag code={roomCode} />}
          <button onClick={onExit} style={btnSmall}>Exit</button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        {/* Center: Pokémon + bid + controls */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Current Pokémon card */}
          <div style={{
            padding: '20px 24px', borderRadius: 12, border: '1px solid var(--border)',
            background: 'var(--bg1)', display: 'flex', gap: 24, alignItems: 'center',
          }}>
            <PokemonImage name={currentPokemon.name} spriteUrl={currentPokemon.spriteUrl} size={110} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 2 }}>
                {currentPokemon.name}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>
                Nominated by {nomName}
              </div>
              <div style={{ display: 'flex', gap: 24, alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.08em', color: 'var(--text-muted)', marginBottom: 2 }}>
                    CURRENT BID
                  </div>
                  <div style={{ fontSize: 30, fontWeight: 800, color: leaderColor, lineHeight: 1 }}>
                    {PD}{currentBid.amount.toLocaleString()}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>
                    by {leaderName}{leader === myIndex && transport === 'room' ? ' (you)' : ''}
                  </div>
                </div>
                <CountdownRing
                  remaining={countdown}
                  total={config.auctionTimer}
                  color={urgent ? '#f87171' : leaderColor}
                  size={80}
                />
                {urgent && (
                  <div style={{ fontSize: 13, fontWeight: 800, color: '#f87171', letterSpacing: '.04em' }}>
                    GOING…
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Bid controls — one per player (local) or just for me (room) */}
          {biddingPlayers.map(pl => (
            <BidRow
              key={pl.index}
              player={pl}
              money={state.money[pl.index] ?? 0}
              minBid={minBid}
              minIncrement={config.minIncrement}
              isYou={pl.index === myIndex}
              transport={transport}
              full={(state.picks[pl.index]?.length ?? 0) >= config.picksPerPlayer}
              onAuto={() => dispatch({ type: 'autoBid', by: pl.index })}
              onPlace={amount => dispatch({ type: 'placeBid', amount, by: pl.index })}
            />
          ))}
        </div>

        <Sidebar state={state} players={players} myIndex={myIndex} />
      </div>
    </div>
  );
}

// ── Done phase ──────────────────────────────────────────────────────────────────
function DonePhase({ state, players, myIndex, restart, isHost, transport, roomCode, onExit }) {
  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
        marginBottom: 24, gap: 12,
      }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 4 }}>Auction complete</h1>
          {transport === 'room' && (
            <div style={{ marginTop: 4 }}><RoomTag code={roomCode} /></div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {isHost && <button onClick={restart} style={btnPrimary}>New Auction</button>}
          <button onClick={onExit} style={btnSmall}>Exit</button>
        </div>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${Math.min(players.length, 3)}, 1fr)`,
        gap: 24,
      }}>
        {players.map(pl => {
          const color = colorFor(pl.index);
          const spent = state.config.startingCash - (state.money[pl.index] ?? 0);
          return (
            <div key={pl.index}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
                <span style={{ fontSize: 14, fontWeight: 800, color }}>
                  {pl.name}{pl.index === myIndex ? ' (you)' : ''}
                </span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {PD}{spent.toLocaleString()} spent · {PD}{(state.money[pl.index] ?? 0).toLocaleString()} left
                </span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                {(state.picks[pl.index] ?? []).map(p => (
                  <div key={p.name} style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                    padding: '10px 6px', borderRadius: 10,
                    border: '1px solid var(--border)', background: 'var(--bg1)',
                  }}>
                    <PokemonImage name={p.name} spriteUrl={p.spriteUrl} size={56} />
                    <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-secondary)', textAlign: 'center' }}>
                      {p.name}
                    </span>
                  </div>
                ))}
                {Array.from({ length: Math.max(0, state.config.picksPerPlayer - (state.picks[pl.index]?.length ?? 0)) }).map((_, i) => (
                  <div key={i} style={{ height: 90, borderRadius: 10, border: '1px dashed var(--border)', opacity: 0.3 }} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Main board ──────────────────────────────────────────────────────────────────
export default function AuctionBoard({ game, transport, roomCode, onExit }) {
  const { state, dispatch, restart, players, myIndex, isHost } = game;

  // Play a happy chime the moment bidding resolves in my favor — i.e. the
  // phase just left 'bidding' and I was the leader on the bid that closed it.
  // Play a dark little blip when it becomes my turn to nominate.
  const prevRef = useRef(null);
  useEffect(() => {
    const prev = prevRef.current;
    if (prev && prev.phase === 'bidding' && state?.phase !== 'bidding'
      && prev.currentBid?.byIndex === myIndex) {
      playWinChime();
    }
    if (state?.phase === 'selection') {
      const nominator = state.order[state.nominationTurn];
      const wasMyTurn = prev?.phase === 'selection' && prev.order[prev.nominationTurn] === myIndex;
      if (nominator === myIndex && !wasMyTurn) playTurnChime();
    }
    prevRef.current = state;
  }, [state, myIndex]);

  // Host fires timer-expiry actions so all clients stay in sync via broadcast.
  useEffect(() => {
    if (!isHost || !state) return;
    if (state.phase === 'selection' && state.selectionTimer) {
      const delay = Math.max(0, state.selectionTimer.startedAt + 30_000 - Date.now());
      const id = setTimeout(() => dispatch({ type: 'selectionTimeout', now: Date.now() }), delay);
      return () => clearTimeout(id);
    }
    if (state.phase === 'bidding' && state.bidTimer) {
      const delay = Math.max(0, state.bidTimer.startedAt + state.config.auctionTimer * 1000 - Date.now());
      const id = setTimeout(() => dispatch({ type: 'bidTimeout', now: Date.now() }), delay);
      return () => clearTimeout(id);
    }
  }, [state?.phase, state?.selectionTimer?.startedAt, state?.bidTimer?.startedAt, isHost, state?.config?.auctionTimer, dispatch]);

  if (!state) {
    return (
      <div style={{ textAlign: 'center', padding: '80px 20px', color: 'var(--text-muted)' }}>
        Waiting for the host to start…
      </div>
    );
  }

  const common = { state, dispatch, players, myIndex, transport, roomCode, onExit };

  if (state.phase === 'selection') return <SelectionPhase {...common} />;
  if (state.phase === 'bidding')   return <BiddingPhase   {...common} />;
  return <DonePhase {...common} restart={restart} isHost={isHost} />;
}

// ── Shared styles ────────────────────────────────────────────────────────────────
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

const btnPrimary = {
  padding: '8px 22px', borderRadius: 8, fontSize: 13, fontWeight: 800, cursor: 'pointer',
  border: '1px solid var(--accent)',
  background: 'color-mix(in srgb, var(--accent) 15%, transparent)',
  color: 'var(--accent)',
};
const btnSmall = {
  padding: '6px 14px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer',
  border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text-muted)',
};
