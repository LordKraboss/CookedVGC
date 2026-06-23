// src/pages/Draft.jsx
// Lobby + session host for game modes. Flow:
//   pick mode → set max players → Create room / Join with code / Play locally
// The board itself (DraftBoard) is mode-specific and transport-agnostic.
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getUsage } from '../lib/api';
import { useRegulation } from '../lib/RegulationContext';
import { MODE_LIST, getMode } from '../game/modes';
import { useGameRoom } from '../game/useGameRoom';
import { emitAck, getSocket } from '../lib/gameSocket';
import { getClientId } from '../lib/clientId';
import DraftBoard from '../game/DraftBoard';
import AuctionBoard from '../game/AuctionBoard';

function isMega(name) {
  return /(-mega|-megax|-megay)/i.test(name.replace(/\s/g, '-'));
}

// Remember the active room so a reload can drop us back into our seat.
const ACTIVE_ROOM_KEY = 'vgc_active_room';
function rememberRoom(code, name) {
  try { sessionStorage.setItem(ACTIVE_ROOM_KEY, JSON.stringify({ code, name })); } catch { /* ignore */ }
}
function forgetRoom() {
  try { sessionStorage.removeItem(ACTIVE_ROOM_KEY); } catch { /* ignore */ }
}
function recallRoom() {
  try { return JSON.parse(sessionStorage.getItem(ACTIVE_ROOM_KEY) || 'null'); } catch { return null; }
}

// ── Mode card ─────────────────────────────────────────────────────────────────
// The selected mode is shown "featured": full-width, bigger type, and its rule
// rendered inside the (taller) box. Unselected modes show only their name.
function ModeCard({ mode, active, onSelect }) {
  return (
    <button
      onClick={onSelect}
      style={{
        textAlign: 'left', padding: active ? '18px 20px' : '14px 16px', borderRadius: 10, cursor: 'pointer',
        border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
        background: active ? 'color-mix(in srgb, var(--accent) 8%, var(--bg1))' : 'var(--bg1)',
        transition: 'border-color .15s',
        width: '100%', whiteSpace: 'normal',
      }}>
      <div style={{
        fontSize: active ? 20 : 15, fontWeight: 800,
        color: active ? 'var(--accent)' : 'var(--text-primary)',
        marginBottom: active ? 8 : 0,
      }}>
        {mode.meta.icon} {mode.meta.label}
      </div>
      {active && (
        <div style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.5 }}>
          {mode.meta.description}
        </div>
      )}
    </button>
  );
}

// ── Lobby ───────────────────────────────────────────────────────────────────────
const PD = '₽';
const AUCTION_TIMER_OPTIONS = [10, 15, 20, 30];

function Lobby({ onPlay, sourceReady, sourceCount }) {
  const [modeId, setModeId]   = useState(MODE_LIST[0].meta.id);
  const [players, setPlayers] = useState(MODE_LIST[0].meta.defaultPlayers);
  const [name, setName]       = useState('');
  const [code, setCode]       = useState('');
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState('');

  // Auction-specific config (ignored for non-auction modes)
  const [startingCash, setStartingCash] = useState(1000);
  const [minIncrement, setMinIncrement] = useState(50);
  const [auctionTimer, setAuctionTimer] = useState(10);

  const mode = getMode(modeId);
  const comingSoon = !!mode.meta.disabled; // mock modes can't be played yet
  const { minPlayers, maxPlayers } = mode.meta; // cap comes from the mode itself
  const playerChoices = Array.from({ length: Math.min(maxPlayers - minPlayers + 1, 8) }, (_, i) => minPlayers + i);
  const clampPlayers = n => Math.max(minPlayers, Math.min(maxPlayers, Math.floor(Number(n) || minPlayers)));

  const auctionConfig = modeId === 'auction'
    ? { startingCash: Math.max(1, Number(startingCash) || 1000), minIncrement: Math.max(1, Number(minIncrement) || 50), auctionTimer }
    : {};

  async function createRoom() {
    const count = clampPlayers(players);
    setBusy(true); setError('');
    try {
      const res = await emitAck('room:create', { mode: modeId, maxPlayers: count, name: name || 'Host', clientId: getClientId() });
      if (!res?.ok) throw new Error(res?.error || 'Could not create room');
      rememberRoom(res.room.code, name || 'Host');
      onPlay({ transport: 'room', modeId, config: { players: count, ...auctionConfig }, room: { ...res.room, youId: res.youId, state: res.state ?? null } });
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  async function joinRoom() {
    if (!code.trim()) { setError('Enter a room code'); return; }
    setBusy(true); setError('');
    try {
      const res = await emitAck('room:join', { code: code.trim().toUpperCase(), name: name || 'Player', clientId: getClientId() });
      if (!res?.ok) throw new Error(res?.error || 'Could not join room');
      rememberRoom(res.room.code, name || 'Player');
      onPlay({ transport: 'room', modeId: res.room.mode, config: { players: clampPlayers(players), ...auctionConfig }, room: { ...res.room, youId: res.youId, state: res.state ?? null } });
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  function playLocal() {
    onPlay({ transport: 'local', modeId, config: { players: clampPlayers(players), ...auctionConfig }, room: null });
  }

  return (
    <div style={{ maxWidth: 620, margin: '40px auto' }}>
      <h1 style={{ fontSize: 26, fontWeight: 800, marginBottom: 6 }}>Game Room</h1>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 24 }}>
        Pick a mode and play locally (pass-and-play) or create a room to play with friends — no account needed.
      </p>

      {/* Mode picker — selected mode is featured full-width on top, the rest
          stack below, 3 per row. */}
      <SectionLabel>MODE</SectionLabel>
      <div style={{ marginBottom: 22 }}>
        {(() => {
          const select = id => () => {
            const m = getMode(id);
            setModeId(id);
            setPlayers(m.meta.defaultPlayers);
            if (m.meta.defaults) {
              setStartingCash(m.meta.defaults.startingCash ?? 1000);
              setMinIncrement(m.meta.defaults.minIncrement ?? 50);
              setAuctionTimer(m.meta.defaults.auctionTimer ?? 10);
            }
          };
          const rest = MODE_LIST.filter(m => m.meta.id !== modeId);
          return (
            <>
              <ModeCard mode={mode} active onSelect={select(modeId)} />
              {rest.length > 0 && (
                <div className="stack-mobile" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginTop: 10 }}>
                  {rest.map(m => (
                    <ModeCard key={m.meta.id} mode={m} active={false} onSelect={select(m.meta.id)} />
                  ))}
                </div>
              )}
            </>
          );
        })()}
      </div>

      {/* Max players */}
      <SectionLabel>
        PLAYERS{' '}
        <span style={{ color: 'var(--text-secondary)', fontWeight: 700 }}>
          (Max Players : {maxPlayers ?? 'Unlimited'})
        </span>
      </SectionLabel>
      <div style={{ display: 'flex', gap: 8, marginBottom: 22, alignItems: 'center', flexWrap: 'wrap' }}>
        {playerChoices.map(n => {
          const active = players === n;
          return (
            <button key={n} onClick={() => setPlayers(n)}
              style={{
                padding: '8px 18px', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer',
                border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                background: active ? 'color-mix(in srgb, var(--accent) 14%, transparent)' : 'var(--bg2)',
                color: active ? 'var(--accent)' : 'var(--text-muted)',
              }}>
              {n}
            </button>
          );
        })}

        {/* Manual entry: − [n] + */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 6 }}>
          <button onClick={() => setPlayers(p => clampPlayers(p - 1))} style={stepBtn}>−</button>
          <input
            type="number" min={minPlayers} max={maxPlayers} value={players}
            onChange={e => setPlayers(e.target.value === '' ? '' : Math.floor(Number(e.target.value)))}
            onBlur={e => setPlayers(clampPlayers(e.target.value))}
            style={{
              ...inputStyle, width: 56, textAlign: 'center', padding: '8px 6px',
              fontWeight: 700, MozAppearance: 'textfield',
            }}
          />
          <button onClick={() => setPlayers(p => clampPlayers(p + 1))} style={stepBtn}>+</button>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 4 }}>players</span>
        </div>
      </div>
      <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: -14, marginBottom: 22 }}>
        For a room, this is the max capacity — the game starts with whoever has joined.
      </p>

      {/* Auction-specific settings */}
      {modeId === 'auction' && (
        <div style={{ marginBottom: 22 }}>
          <SectionLabel>AUCTION SETTINGS</SectionLabel>
          <div className="stack-mobile" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>Starting cash</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
                <span style={{
                  padding: '10px 11px', background: 'var(--bg2)', border: '1px solid var(--border)',
                  borderRight: 'none', borderRadius: '8px 0 0 8px',
                  fontSize: 13, fontWeight: 700, color: 'var(--text-muted)',
                }}>{PD}</span>
                <input
                  type="number" min={1} value={startingCash}
                  onChange={e => setStartingCash(e.target.value)}
                  onBlur={e => setStartingCash(Math.max(1, Number(e.target.value) || 1000))}
                  style={{ ...inputStyle, borderRadius: '0 8px 8px 0', MozAppearance: 'textfield' }}
                />
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>Min. increment</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
                <span style={{
                  padding: '10px 11px', background: 'var(--bg2)', border: '1px solid var(--border)',
                  borderRight: 'none', borderRadius: '8px 0 0 8px',
                  fontSize: 13, fontWeight: 700, color: 'var(--text-muted)',
                }}>{PD}</span>
                <input
                  type="number" min={1} value={minIncrement}
                  onChange={e => setMinIncrement(e.target.value)}
                  onBlur={e => setMinIncrement(Math.max(1, Number(e.target.value) || 50))}
                  style={{ ...inputStyle, borderRadius: '0 8px 8px 0', MozAppearance: 'textfield' }}
                />
              </div>
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>Auction timer (seconds)</div>
            <div style={{ display: 'flex', gap: 8 }}>
              {AUCTION_TIMER_OPTIONS.map(t => {
                const active = auctionTimer === t;
                return (
                  <button key={t} onClick={() => setAuctionTimer(t)} style={{
                    padding: '8px 18px', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer',
                    border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                    background: active ? 'color-mix(in srgb, var(--accent) 14%, transparent)' : 'var(--bg2)',
                    color: active ? 'var(--accent)' : 'var(--text-muted)',
                  }}>
                    {t}s
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Name */}
      <SectionLabel>YOUR NAME (for rooms)</SectionLabel>
      <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Ash"
        maxLength={24}
        style={{ ...inputStyle, marginBottom: 22 }} />

      {error && <div style={{ color: '#f87171', fontSize: 12, marginBottom: 14 }}>{error}</div>}

      {/* Actions */}
      {comingSoon ? (
        <div style={{
          padding: '14px 16px', borderRadius: 10, border: '1px dashed var(--border)',
          background: 'var(--bg1)', color: 'var(--text-muted)', fontSize: 13, textAlign: 'center',
        }}>
          🚧 {mode.meta.label} is coming soon.
        </div>
      ) : (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <button onClick={playLocal} disabled={!sourceReady || busy} style={btnPrimaryLg(!sourceReady || busy)}>
          {sourceReady ? '▶ Play locally (pass-and-play)' : 'Loading Pokémon…'}
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: 'var(--text-muted)', fontSize: 11 }}>
          <div style={{ flex: 1, height: 1, background: 'var(--border)' }} /> OR PLAY ONLINE <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
        </div>

        <button onClick={createRoom} disabled={!sourceReady || busy} style={btnOutlineLg(!sourceReady || busy)}>
          ＋ Create room
        </button>

        <div style={{ display: 'flex', gap: 10 }}>
          <input value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="Room code"
            maxLength={6}
            style={{ ...inputStyle, flex: 1, fontFamily: 'var(--mono)', letterSpacing: '.15em', textTransform: 'uppercase' }} />
          <button onClick={joinRoom} disabled={busy} style={btnOutlineLg(busy)}>Join</button>
        </div>
      </div>
      )}

      {sourceReady && sourceCount < clampPlayers(players) * getMode(modeId).meta.picksPerPlayer && (
        <p style={{ fontSize: 11, color: '#fbbf24', marginTop: 16 }}>
          Only {sourceCount} eligible Pokémon this regulation — picks per player will scale down to fit.
        </p>
      )}
    </div>
  );
}

// ── Room waiting lobby (before the host starts) ────────────────────────────────
function RoomWaiting({ game, roomCode, onStart, onExit }) {
  const { members, isHost, status } = game;
  if (status === 'closed') {
    return (
      <div style={{ maxWidth: 500, margin: '80px auto', textAlign: 'center' }}>
        <p style={{ fontSize: 14, color: '#f87171', marginBottom: 18 }}>The host closed the room.</p>
        <button onClick={onExit} style={btnOutlineLg(false)}>Back to menu</button>
      </div>
    );
  }
  return (
    <div style={{ maxWidth: 520, margin: '40px auto', textAlign: 'center' }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 8 }}>Waiting room</h1>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 6 }}>Share this code with your friends:</p>
      <div style={{
        fontSize: 40, fontWeight: 800, fontFamily: 'var(--mono)', letterSpacing: '.2em',
        color: 'var(--accent)', marginBottom: 24,
      }}>
        {roomCode}
      </div>

      <SectionLabel>PLAYERS ({members.length})</SectionLabel>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, margin: '10px 0 24px' }}>
        {members.map(m => (
          <div key={m.id} style={{
            padding: '10px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg1)',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <span style={{ fontSize: 13, fontWeight: 700 }}>{m.name}</span>
            {m.isHost && <span style={{ fontSize: 10, color: 'var(--accent)', fontWeight: 700 }}>HOST ★</span>}
          </div>
        ))}
      </div>

      {isHost ? (
        <button onClick={onStart} disabled={members.length < 2} style={btnPrimaryLg(members.length < 2)}>
          {members.length < 2 ? 'Waiting for at least 1 more…' : `Start (${members.length} players)`}
        </button>
      ) : (
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Waiting for the host to start…</p>
      )}
      <div style={{ marginTop: 14 }}>
        <button onClick={onExit} style={btnGhostLg}>Leave</button>
      </div>
    </div>
  );
}

// ── Active session (always calls the hook — no conditional hooks) ───────────────
function GameSession({ session, source, onExit }) {
  const mode = getMode(session.modeId);
  const game = useGameRoom({
    mode,
    transport: session.transport,
    config: session.config,
    source,
    room: session.room,
  });

  const roomCode = session.room?.code;

  // Room, not started yet → waiting lobby.
  if (session.transport === 'room' && !game.state) {
    return <RoomWaiting game={game} roomCode={roomCode} onStart={game.start} onExit={onExit} />;
  }

  // Otherwise render the mode's board.
  const Board = session.modeId === 'auction' ? AuctionBoard : DraftBoard;
  return <Board game={game} transport={session.transport} roomCode={roomCode} onExit={onExit} />;
}

// ── Page ─────────────────────────────────────────────────────────────────────────
export default function Draft() {
  const { activeRegId } = useRegulation();
  const [session, setSession] = useState(null);
  const [rejoining, setRejoining] = useState(true); // probing for a room to reclaim

  const { data: usageList = [], isLoading } = useQuery({
    queryKey: ['usage', activeRegId],
    queryFn:  () => getUsage(activeRegId),
    enabled:  !!activeRegId,
    staleTime: 5 * 60_000,
  });

  const eligible = useMemo(() => usageList.filter(p => !isMega(p.name)), [usageList]);
  const sourceReady = !isLoading && eligible.length > 0;

  // On mount, if we were in a room this session, try to reclaim our seat.
  useEffect(() => {
    const saved = recallRoom();
    if (!saved?.code) { setRejoining(false); return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await emitAck('room:join', { code: saved.code, name: saved.name, clientId: getClientId() });
        if (cancelled) return;
        if (res?.ok) {
          setSession({
            transport: 'room', modeId: res.room.mode,
            config: { players: res.room.members.length },
            room: { ...res.room, youId: res.youId, state: res.state ?? null },
          });
        } else {
          forgetRoom();
        }
      } catch { forgetRoom(); }
      finally { if (!cancelled) setRejoining(false); }
    })();
    return () => { cancelled = true; };
  }, []);

  function handleExit() {
    if (session?.transport === 'room') {
      try { getSocket().emit('room:leave'); } catch { /* ignore */ }
    }
    forgetRoom();
    setSession(null);
  }

  if (rejoining && !session) {
    return <div style={{ maxWidth: 520, margin: '80px auto', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>Reconnecting…</div>;
  }
  if (!session) {
    return <Lobby onPlay={setSession} sourceReady={sourceReady} sourceCount={eligible.length} />;
  }
  return <GameSession key={session.room?.code ?? 'local'} session={session} source={eligible} onExit={handleExit} />;
}

// ── Shared styles ─────────────────────────────────────────────────────────────────
function SectionLabel({ children }) {
  return <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.08em', color: 'var(--text-muted)', marginBottom: 8 }}>{children}</div>;
}
const inputStyle = {
  background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8,
  color: 'var(--text-primary)', fontSize: 13, padding: '10px 12px', outline: 'none', width: '100%', fontFamily: 'inherit',
};
const btnPrimaryLg = (disabled) => ({
  padding: '13px', borderRadius: 10, fontSize: 14, fontWeight: 800, width: '100%',
  border: '1px solid var(--accent)', background: 'color-mix(in srgb, var(--accent) 15%, transparent)',
  color: 'var(--accent)', cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1,
});
const btnOutlineLg = (disabled) => ({
  padding: '13px 20px', borderRadius: 10, fontSize: 13, fontWeight: 700,
  border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text-secondary)',
  cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1, whiteSpace: 'nowrap',
});
const btnGhostLg = {
  padding: '10px 20px', borderRadius: 8, fontSize: 12, fontWeight: 700,
  border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer',
};
const stepBtn = {
  width: 32, height: 36, borderRadius: 8, fontSize: 18, fontWeight: 700, lineHeight: 1, cursor: 'pointer',
  border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text-secondary)',
};
