// src/pages/Tournament.jsx
// Live tournament: create / join by code → lobby (team submit + organizer review +
// launch) → running. Server-authoritative; this page polls scoped state and acts
// via REST. Identity is the stable clientId; the active code is remembered so a
// refresh returns to the room.
import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRegulation } from '../lib/RegulationContext';
import { getClientId } from '../lib/clientId';
import { getSocket } from '../lib/gameSocket';
import {
  tourneyCreate, tourneyGet, tourneyJoin, tourneySubmitTeam,
  tourneyRejectTeam, tourneyLaunch, tourneyDestroy, tourneyClose,
  tourneyReport, tourneyPresent, tourneyNoShow, tourneyResolve, tourneyAdvance, tourneyDrop,
} from '../lib/api';
import { TeamSheet } from '../components/PokemonChip';

const ACTIVE_KEY = 'vgc_tourney_code';
const TEAMS_KEY  = 'vgc_teams_v2';

function localTeams(regId) {
  try {
    const { teams = [] } = JSON.parse(localStorage.getItem(TEAMS_KEY) || '{}');
    return teams.filter(t => !regId || t.reg === regId);
  } catch { return []; }
}

const FORMATS = [
  { id: 'round_robin',   label: 'Round Robin', desc: 'Everyone plays everyone once. Final ranking, no playoff.' },
  { id: 'swiss',         label: 'Swiss',       desc: 'Fixed number of rounds, paired by record (VGC style).' },
  { id: 'playoff',       label: 'Playoff',     desc: 'Direct single/double-elimination bracket, random seeding.' },
  { id: 'swiss_playoff', label: 'Swiss + Playoff', desc: 'Swiss qualifier, then a seeded single-elim cut.' },
];
const POW2 = [2, 4, 8, 16, 32, 64];

// ── Create / Join ─────────────────────────────────────────────────────────────
function CreateOrJoin({ onEnter, clientId }) {
  const { regs = [], activeRegId } = useRegulation();
  const [mode, setMode]   = useState('create');
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState('');

  // create state
  const [name, setName]     = useState('');
  const [regId, setRegId]   = useState(activeRegId);
  const [format, setFormat] = useState('swiss');
  const [bestOf, setBestOf] = useState(3);
  const [swissBestOf, setSwissBestOf]   = useState(3);
  const [playoffBestOf, setPlayoffBestOf] = useState(3);
  const [swissRounds, setSwissRounds]   = useState(5);
  const [playoffSize, setPlayoffSize]   = useState(8);
  const [playoffType, setPlayoffType]   = useState('single');
  const [thirdPlace, setThirdPlace]     = useState(true);
  const [teamsheet, setTeamsheet]       = useState('closed');
  const [noShowMinutes, setNoShow]      = useState(10);
  const [masterPlays, setMasterPlays]   = useState(true);
  const [yourName, setYourName]         = useState('');

  // join state
  const [joinCode, setJoinCode] = useState('');
  const [joinName, setJoinName] = useState('');

  const needsSwiss   = format === 'swiss' || format === 'swiss_playoff';
  const needsPlayoff = format === 'playoff' || format === 'swiss_playoff';
  const isCombo      = format === 'swiss_playoff';
  const showThird    = format === 'swiss_playoff' || (format === 'playoff' && playoffType === 'single');

  function buildConfig() {
    const c = { teamsheet, noShowMinutes: Number(noShowMinutes) };
    if (isCombo) { c.swissBestOf = swissBestOf; c.playoffBestOf = playoffBestOf; }
    else c.bestOf = bestOf;
    if (needsSwiss)   c.swissRounds = Number(swissRounds);
    if (needsPlayoff) c.playoffSize = Number(playoffSize);
    if (format === 'playoff') { c.playoffType = playoffType; if (showThird) c.thirdPlace = thirdPlace; }
    if (format === 'swiss_playoff') c.thirdPlace = thirdPlace;
    return c;
  }

  async function create() {
    if (!name.trim()) { setError('Give the tournament a name'); return; }
    setBusy(true); setError('');
    try {
      const { code } = await tourneyCreate({
        name: name.trim(), regId, format, config: buildConfig(),
        clientId, masterName: yourName || 'Organizer', masterPlays,
      });
      onEnter(code);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  async function join() {
    if (!joinCode.trim()) { setError('Enter a code'); return; }
    setBusy(true); setError('');
    try {
      const code = joinCode.trim().toUpperCase();
      await tourneyJoin(code, clientId, joinName || 'Player');
      onEnter(code);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  return (
    <div style={{ maxWidth: 680, margin: '32px auto' }}>
      <h1 style={{ fontSize: 26, fontWeight: 800 }}>🏆 Tournament</h1>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>
        Run your own bracket — players join by code, no account needed. Battles are played
        outside the site; here you manage pairings, teamsheets and results.
      </p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 22 }}>
        {['create', 'join'].map(m => (
          <button key={m} onClick={() => { setMode(m); setError(''); }}
            style={tabBtn(mode === m)}>{m === 'create' ? 'Create' : 'Join with code'}</button>
        ))}
      </div>

      {error && <div style={errBox}>{error}</div>}

      {mode === 'create' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Field label="TOURNAMENT NAME">
            <input value={name} onChange={e => setName(e.target.value)} maxLength={60}
              placeholder="e.g. Friday Night VGC" style={input} />
          </Field>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <Field label="REGULATION" style={{ flex: 1, minWidth: 180 }}>
              <select value={regId} onChange={e => setRegId(e.target.value)} style={input}>
                {regs.map(r => <option key={r.id} value={r.id}>{r.label ?? r.id}</option>)}
              </select>
            </Field>
            <Field label="YOUR NAME" style={{ flex: 1, minWidth: 180 }}>
              <input value={yourName} onChange={e => setYourName(e.target.value)} maxLength={24}
                placeholder="Organizer" style={input} />
            </Field>
          </div>

          <Field label="FORMAT">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 8 }}>
              {FORMATS.map(f => (
                <button key={f.id} onClick={() => setFormat(f.id)} style={cardBtn(format === f.id)}>
                  <div style={{ fontWeight: 800, fontSize: 14, color: format === f.id ? 'var(--accent)' : 'var(--text-primary)' }}>{f.label}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3, lineHeight: 1.35 }}>{f.desc}</div>
                </button>
              ))}
            </div>
          </Field>

          {/* dynamic config */}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {needsSwiss && (
              <Field label="SWISS ROUNDS" style={{ width: 140 }}>
                <input type="number" min={1} value={swissRounds}
                  onChange={e => setSwissRounds(e.target.value)} style={input} />
              </Field>
            )}
            {needsPlayoff && (
              <Field label="PLAYOFF CUT" style={{ width: 140 }}>
                <select value={playoffSize} onChange={e => setPlayoffSize(Number(e.target.value))} style={input}>
                  {POW2.map(n => <option key={n} value={n}>{n} players</option>)}
                </select>
              </Field>
            )}
            {format === 'playoff' && (
              <Field label="BRACKET" style={{ width: 170 }}>
                <select value={playoffType} onChange={e => setPlayoffType(e.target.value)} style={input}>
                  <option value="single">Single elimination</option>
                  <option value="double">Double elimination</option>
                </select>
              </Field>
            )}
          </div>

          {/* best of */}
          {isCombo ? (
            <div style={{ display: 'flex', gap: 12 }}>
              <Field label="SWISS — BEST OF" style={{ flex: 1 }}><BoToggle value={swissBestOf} onChange={setSwissBestOf} /></Field>
              <Field label="PLAYOFF — BEST OF" style={{ flex: 1 }}><BoToggle value={playoffBestOf} onChange={setPlayoffBestOf} /></Field>
            </div>
          ) : (
            <Field label="BEST OF"><BoToggle value={bestOf} onChange={setBestOf} /></Field>
          )}

          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'center' }}>
            <Field label="TEAMSHEET" style={{ width: 220 }}>
              <div style={{ display: 'flex', gap: 6 }}>
                {['closed', 'open'].map(t => (
                  <button key={t} onClick={() => setTeamsheet(t)} style={pill(teamsheet === t)}>{t}</button>
                ))}
              </div>
            </Field>
            <Field label="NO-SHOW TIMER (MIN)" style={{ width: 160 }}>
              <input type="number" min={1} value={noShowMinutes} onChange={e => setNoShow(e.target.value)} style={input} />
            </Field>
            {showThird && (
              <label style={checkRow}>
                <input type="checkbox" checked={thirdPlace} onChange={e => setThirdPlace(e.target.checked)} />
                3rd-place match
              </label>
            )}
            <label style={checkRow}>
              <input type="checkbox" checked={masterPlays} onChange={e => setMasterPlays(e.target.checked)} />
              I'm also playing
            </label>
          </div>

          <button onClick={create} disabled={busy} style={primaryLg(busy)}>
            {busy ? 'Creating…' : 'Create tournament'}
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 360 }}>
          <Field label="ROOM CODE">
            <input value={joinCode} onChange={e => setJoinCode(e.target.value.toUpperCase())} maxLength={6}
              placeholder="ABCD" style={{ ...input, fontFamily: 'var(--mono)', letterSpacing: '.2em' }} />
          </Field>
          <Field label="YOUR NAME">
            <input value={joinName} onChange={e => setJoinName(e.target.value)} maxLength={24}
              placeholder="e.g. Ash" style={input} />
          </Field>
          <button onClick={join} disabled={busy} style={primaryLg(busy)}>{busy ? 'Joining…' : 'Join'}</button>
        </div>
      )}
    </div>
  );
}

// ── Room ────────────────────────────────────────────────────────────────────────
function Room({ code, clientId, onLeave }) {
  const qc = useQueryClient();
  const { data: st, error } = useQuery({
    queryKey: ['tourney', code, clientId],
    queryFn: () => tourneyGet(code, clientId),
    refetchInterval: 20000, // fallback only — live updates arrive over the socket
    retry: false,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['tourney', code, clientId] });

  // Live updates: subscribe to this tournament's socket room and refetch on change.
  useEffect(() => {
    const socket = getSocket();
    const sub = () => socket.emit('tourney:subscribe', { code });
    const onChanged = (msg) => {
      if (!msg || msg.code === code) qc.invalidateQueries({ queryKey: ['tourney', code, clientId] });
    };
    sub();
    socket.on('connect', sub);           // re-subscribe after a reconnect
    socket.on('tournament:changed', onChanged);
    return () => {
      socket.emit('tourney:unsubscribe', { code });
      socket.off('connect', sub);
      socket.off('tournament:changed', onChanged);
    };
  }, [code, clientId, qc]);
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState('');

  if (error) {
    return (
      <Centered>
        <p style={{ color: '#f87171', marginBottom: 16 }}>{error.message}</p>
        <button onClick={onLeave} style={outlineLg}>Back</button>
      </Centered>
    );
  }
  if (!st) return <Centered><p style={{ color: 'var(--text-muted)' }}>Loading…</p></Centered>;

  const isMaster = st.you.isMaster;
  const teams = localTeams(st.regId);

  async function act(fn) {
    setBusy(true); setErr('');
    try { await fn(); refresh(); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  const submitTeam = (team) => act(() => tourneySubmitTeam(code, clientId, team));
  const reject = (target, comment) => act(() => tourneyRejectTeam(code, clientId, target, comment));
  const launch = () => act(() => tourneyLaunch(code, clientId));
  const close = () => {
    if (confirm('Complete this tournament? The room is freed and the result stays saved in the Results archive.'))
      act(() => tourneyClose(code, clientId)).then(onLeave);
  };
  const destroy = () => {
    const msg = st?.status === 'complete'
      ? 'DESTROY this tournament? Its saved result is permanently deleted from the archive. This cannot be undone.'
      : 'DESTROY this tournament? The room and all progress are permanently deleted. (To keep results, advance to “🏆 Complete tournament” first.)';
    if (confirm(msg)) act(() => tourneyDestroy(code, clientId)).then(onLeave);
  };
  const report  = (matchId, p1, p2) => act(() => tourneyReport(code, matchId, clientId, p1, p2));
  const present = (matchId) => act(() => tourneyPresent(code, matchId, clientId));
  const noShow  = (matchId) => act(() => tourneyNoShow(code, matchId, clientId));
  const resolve = (matchId, payload) => act(() => tourneyResolve(code, matchId, clientId, payload));
  const advance = () => act(() => tourneyAdvance(code, clientId));
  const drop    = (target) => { if (confirm('Drop this player? Their remaining matches are forfeited.')) act(() => tourneyDrop(code, target, clientId)); };
  const runProps = { st, clientId, isMaster, onReport: report, onPresent: present, onNoShow: noShow, onResolve: resolve, onAdvance: advance, onDrop: drop, busy };

  return (
    <div style={{ maxWidth: 820, margin: '28px auto' }}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap', marginBottom: 6 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800 }}>{st.name}</h1>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 20, fontWeight: 800, letterSpacing: '.18em', color: 'var(--accent)' }}>{st.code}</span>
        <StatusPill status={st.status} />
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 18 }}>
        {FORMATS.find(f => f.id === st.format)?.label} · {st.regId} ·{' '}
        teamsheet {st.config.teamsheet} · {st.masterPlays ? 'organizer playing' : 'organizer not playing'}
      </div>

      {err && <div style={errBox}>{err}</div>}

      {st.status === 'lobby' && (
        <Lobby st={st} clientId={clientId} teams={teams} isMaster={isMaster}
          onSubmit={submitTeam} onReject={reject} onLaunch={launch} busy={busy} />
      )}
      {st.status === 'running' && <Running {...runProps} />}
      {st.status === 'complete' && <Running {...runProps} done />}
      {st.status === 'closed' && (
        <Centered>
          <p style={{ fontSize: 22, marginBottom: 8 }}>🏆</p>
          <p style={{ color: 'var(--text-muted)', marginBottom: 6 }}>This tournament is closed.</p>
          <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>The result is saved — find it in the Results tab.</p>
        </Centered>
      )}
      {(st.status === 'destroyed' || st.status === 'abandoned') && (
        <Centered><p style={{ color: 'var(--text-muted)' }}>This tournament is {st.status}.</p></Centered>
      )}

      {/* footer controls */}
      <div style={{ display: 'flex', gap: 10, marginTop: 28, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
        <button onClick={onLeave} style={ghost}>Leave room</button>
        <div style={{ flex: 1 }} />
        {st.status === 'complete' && isMaster && (
          <button onClick={close} style={{ ...ghost, color: '#34d399', borderColor: 'rgba(52,211,153,.3)' }}>
            Complete (save results)
          </button>
        )}
        {isMaster && ['lobby', 'running', 'complete'].includes(st.status) && (
          <button onClick={destroy} style={{ ...ghost, color: '#f87171', borderColor: 'rgba(248,113,113,.3)' }}>
            {st.status === 'complete' ? 'Destroy (delete saved result)' : 'Destroy (discard results)'}
          </button>
        )}
      </div>
    </div>
  );
}

function Lobby({ st, clientId, teams, isMaster, onSubmit, onReject, onLaunch, busy }) {
  const me = st.participants.find(p => p.clientId === clientId);
  const readyCount = st.participants.filter(p => p.teamStatus === 'submitted').length;
  const masterReviewer = isMaster && !st.masterPlays;

  return (
    <div className="stack-mobile" style={{ display: 'grid', gridTemplateColumns: masterReviewer ? '1fr' : '1fr 320px', gap: 24 }}>
      {/* participants */}
      <div>
        <SectionLabel>PLAYERS ({st.participants.length}) · {readyCount} ready</SectionLabel>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
          {st.participants.map(p => (
            <div key={p.clientId} style={partRow}>
              <span style={{ fontWeight: 700, fontSize: 13 }}>
                {p.name}{p.clientId === st.masterClientId && <span style={{ color: 'var(--accent)', fontSize: 10, marginLeft: 6 }}>HOST ★</span>}
              </span>
              <div style={{ flex: 1 }} />
              <TeamStatusTag status={p.teamStatus} />
              {masterReviewer && p.teamStatus === 'submitted' && (
                <button style={miniBtn} onClick={() => {
                  const c = prompt(`Reject ${p.name}'s team — reason (shown to them):`, '');
                  if (c !== null) onReject(p.clientId, c);
                }}>Reject</button>
              )}
            </div>
          ))}
          {st.participants.length === 0 && <Empty>No players yet — share the code.</Empty>}
        </div>

        {masterReviewer && (
          <div style={{ marginTop: 18 }}>
            <SectionLabel>SUBMITTED TEAMS (review)</SectionLabel>
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {st.participants.filter(p => p.team).map(p => (
                <div key={p.clientId} style={{ ...partRow, alignItems: 'flex-start', flexDirection: 'column', gap: 8 }}>
                  <strong style={{ fontSize: 13 }}>{p.name}</strong>
                  <TeamSheet team={p.team} />
                </div>
              ))}
              {!st.participants.some(p => p.team) && <Empty>No teams submitted yet.</Empty>}
            </div>
          </div>
        )}
      </div>

      {/* my team panel (only if I'm a player) */}
      {!masterReviewer && (
        <div>
          <SectionLabel>YOUR TEAM</SectionLabel>
          <TeamPicker me={me} teams={teams} regId={st.regId} onSubmit={onSubmit} busy={busy} />
        </div>
      )}

      {/* launch — spans */}
      {isMaster && (
        <div style={{ gridColumn: '1 / -1', marginTop: 8 }}>
          <button onClick={onLaunch} disabled={busy || readyCount < 2} style={primaryLg(busy || readyCount < 2)}>
            {readyCount < 2 ? 'Need at least 2 ready players' : `Launch tournament (${readyCount} ready)`}
          </button>
          <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
            Only players who validated a team are entered. Everyone else is dropped.
          </p>
        </div>
      )}
    </div>
  );
}

function TeamPicker({ me, teams, regId, onSubmit, busy }) {
  const [sel, setSel] = useState('');
  const [editing, setEditing] = useState(false);
  if (!me) return <Empty>You're organizing but not playing.</Empty>;

  if (me.teamStatus === 'submitted' && !editing) {
    return (
      <div style={{ ...partRow, flexDirection: 'column', alignItems: 'flex-start', gap: 8 }}>
        <TeamStatusTag status="submitted" />
        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
          {(me.team || []).map(s => s?.name).filter(Boolean).join(', ')}
        </div>
        <button style={miniBtn} onClick={() => setEditing(true)}>Change</button>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {me.teamStatus === 'rejected' && (
        <div style={{ ...errBox, background: 'rgba(248,113,113,.1)' }}>
          Your team was rejected: <em>{me.rejectComment || 'no reason given'}</em>. Pick another and re-validate.
        </div>
      )}
      {teams.length === 0 ? (
        <Empty>No saved teams for <b>{regId}</b>. Build one in “My teams” first.</Empty>
      ) : (
        <>
          <select value={sel} onChange={e => setSel(e.target.value)} style={input}>
            <option value="">Select a team…</option>
            {teams.map(t => (
              <option key={t.id} value={t.id}>
                {t.name} — {t.slots.filter(Boolean).map(s => s.name).join(', ').slice(0, 40)}
              </option>
            ))}
          </select>
          <button disabled={!sel || busy} style={primaryLg(!sel || busy)}
            onClick={() => { const t = teams.find(x => x.id === sel); if (t) { onSubmit(t.slots.filter(Boolean)); setEditing(false); } }}>
            Validate team
          </button>
          {editing && <button style={miniBtn} onClick={() => setEditing(false)}>Cancel</button>}
        </>
      )}
    </div>
  );
}

function Running({ st, clientId, isMaster, onReport, onPresent, onNoShow, onResolve, onAdvance, onDrop, busy, done }) {
  const rounds = [...new Set(st.matches.map(m => m.round))].sort((a, b) => a - b);
  const curRoundMatches = st.matches.filter(m => m.stage === st.stage && m.round === st.currentRound);
  const roundComplete = curRoundMatches.length > 0 &&
    curRoundMatches.every(m => ['validated', 'walkover', 'bye'].includes(m.status));
  // Only an ACTIVATED match counts as "live" — Round Robin pre-generates every
  // round, so future-round matches exist as pending; they must not be playable
  // until the organizer advances (which activates them).
  const myMatch = st.matches.find(m =>
    m.youAreIn && m.activatedAt && !['validated', 'walkover', 'bye'].includes(m.status));
  const disputes = st.matches.filter(m => ['disputed', 'no_show_pending'].includes(m.status));
  const isStaged = st.stage === 'swiss' || st.stage === 'round_robin';

  // Collapsible rounds: by default only the current round is open (the whole
  // bracket stays open for playoff). Advancing re-collapses to the new round;
  // clicking a round header toggles it.
  const [openRounds, setOpenRounds] = useState(() => new Set([st.currentRound]));
  useEffect(() => {
    setOpenRounds(isStaged ? new Set([st.currentRound]) : new Set(rounds));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st.currentRound, st.stage]);
  const toggleRound = (r) => setOpenRounds(prev => {
    const n = new Set(prev); n.has(r) ? n.delete(r) : n.add(r); return n;
  });

  // Final staged round? (swiss → after swissRounds; RR → after the last pre-built round)
  const stageRounds = st.matches.filter(m => m.stage === st.stage).map(m => m.round);
  const lastStageRound = stageRounds.length ? Math.max(...stageRounds) : st.currentRound;
  const finalStaged = isStaged && (st.stage === 'swiss'
    ? st.currentRound >= st.config.swissRounds
    : st.currentRound >= lastStageRound);
  const advanceLabel = !roundComplete ? 'Finish all matches to advance'
    : finalStaged ? (st.format === 'swiss_playoff' && st.stage === 'swiss' ? 'Build playoff bracket →' : '🏆 Complete tournament')
    : 'Advance to next round →';

  if (done) {
    return (
      <div>
        <SectionLabel>🏆 FINAL STANDINGS</SectionLabel>
        <StandingsTable rows={st.finalStandings || st.standings} final />
      </div>
    );
  }

  return (
    <div className="stack-mobile" style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 24, alignItems: 'start' }}>
      <div>
        {/* My match — shown whenever I'm a player with an active match, even if I'm
            also the organizer (so I can report my own score like anyone else). */}
        {myMatch
          ? <MyMatch m={myMatch} clientId={clientId} teamsheet={st.config.teamsheet}
              noShowMinutes={st.config.noShowMinutes} onReport={onReport} onPresent={onPresent} onNoShow={onNoShow} busy={busy} />
          : <div style={{ ...partRow, marginBottom: 18 }}><span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {st.you.isParticipant ? 'No active match for you right now — waiting for the next round.' : 'Spectating.'}
            </span></div>}

        {/* Master: disputes + no-shows */}
        {isMaster && disputes.length > 0 && (
          <div style={{ marginBottom: 18 }}>
            <SectionLabel>NEEDS YOUR REVIEW ({disputes.length})</SectionLabel>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
              {disputes.map(m => <ResolveCard key={m.id} m={m} onResolve={onResolve} busy={busy} />)}
            </div>
          </div>
        )}

        {/* Pairings / bracket */}
        <SectionLabel>{st.stage === 'playoff' ? 'BRACKET' : `${st.stage?.toUpperCase()} · ROUND ${st.currentRound}`}</SectionLabel>
        {isStaged && (
          <div style={{ margin: '10px 0' }}>
            {isMaster ? (
              <button onClick={onAdvance} disabled={busy || !roundComplete} style={primaryLg(busy || !roundComplete)}>
                {advanceLabel}
              </button>
            ) : (
              <div style={{ ...partRow, justifyContent: 'center', fontSize: 12, color: 'var(--text-muted)' }}>
                {roundComplete ? 'Round complete — waiting for the organizer to advance.' : 'Waiting for the organizer to advance the round.'}
              </div>
            )}
          </div>
        )}
        {rounds.map(r => {
          const ms = st.matches.filter(m => m.round === r);
          if (!ms.length) return null;
          // organizer may correct a current-round Swiss/RR result before advancing
          const canEditRound = isMaster && isStaged && r === st.currentRound;
          const open = openRounds.has(r);
          const decided = ms.filter(m => ['validated', 'walkover', 'bye'].includes(m.status)).length;
          const isCurrent = isStaged && r === st.currentRound;
          return (
            <div key={r} style={{ marginBottom: 14, marginTop: 10 }}>
              <div onClick={() => toggleRound(r)}
                style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', userSelect: 'none', fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: open ? 6 : 0 }}>
                <span style={{ fontSize: 9, color: 'var(--text-muted)', width: 10 }}>{open ? '▾' : '▸'}</span>
                {st.stage === 'playoff' ? bracketLabel(r) : `Round ${r}`}
                <span style={{ fontWeight: 500, color: 'var(--text-muted)' }}>· {decided}/{ms.length}</span>
                {isCurrent && <span style={{ color: 'var(--accent)', fontWeight: 700 }}>· current</span>}
              </div>
              {open && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {ms.map(m => (
                  <MatchRow key={m.id} m={m} me={clientId}
                    editable={canEditRound && m.status !== 'bye'} onResolve={onResolve} busy={busy} />
                ))}
              </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Side: standings + master drop */}
      <div>
        {isStaged && (
          <>
            <SectionLabel>STANDINGS</SectionLabel>
            <StandingsTable rows={st.standings} />
          </>
        )}
        {isMaster && (
          <div style={{ marginTop: 18 }}>
            <SectionLabel>PLAYERS</SectionLabel>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
              {st.participants.filter(p => p.status !== 'dropped').map(p => (
                <div key={p.clientId} style={{ ...partRow, padding: '7px 10px' }}>
                  <span style={{ fontSize: 12 }}>{p.name}</span>
                  <div style={{ flex: 1 }} />
                  <button style={miniBtn} onClick={() => onDrop(p.clientId)}>Drop</button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function MatchRow({ m, me, editable, onResolve, busy }) {
  const [editing, setEditing] = useState(false);
  const score = (m.p1Score != null && m.p2Score != null) ? `${m.p1Score}–${m.p2Score}` : null;
  const hl = (id) => m.winnerClientId === id ? { fontWeight: 800, color: 'var(--accent)' } : {};

  // organizer score options (absolute p1–p2)
  const need = m.bestOf === 3 ? 2 : 1;
  const opts = [];
  for (let k = 0; k < need; k++) opts.push([need, k]);
  for (let k = need - 1; k >= 0; k--) opts.push([k, need]);

  return (
    <div style={{ ...partRow, flexDirection: 'column', alignItems: 'stretch', gap: editing ? 8 : 0, padding: '8px 12px', outline: m.youAreIn ? '1px solid var(--accent)' : 'none' }}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <span style={{ fontSize: 13, ...hl(m.p1?.clientId) }}>{m.p1?.name ?? 'TBD'}{m.p1?.clientId === me && ' (you)'}</span>
        <span style={{ color: 'var(--text-muted)', fontSize: 12, margin: '0 8px' }}>{score ?? 'vs'}</span>
        <span style={{ fontSize: 13, ...hl(m.p2?.clientId) }}>
          {m.p2 ? <>{m.p2.name}{m.p2.clientId === me && ' (you)'}</> : <em style={{ color: 'var(--text-muted)' }}>BYE</em>}
        </span>
        <div style={{ flex: 1 }} />
        {editable && <button style={{ ...miniBtn, marginRight: 8 }} onClick={() => setEditing(v => !v)}>{editing ? 'Close' : 'Edit'}</button>}
        <StatusDot status={m.status} />
      </div>
      {editable && editing && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Set result ({m.p1?.name} – {m.p2?.name}):</span>
          {opts.map(([a, b]) => (
            <button key={`${a}-${b}`} disabled={busy} style={pill(m.p1Score === a && m.p2Score === b)}
              onClick={() => { onResolve(m.id, { p1Score: a, p2Score: b }); setEditing(false); }}>{a}–{b}</button>
          ))}
        </div>
      )}
    </div>
  );
}

function MyMatch({ m, clientId, teamsheet, noShowMinutes, onReport, onPresent, onNoShow, busy }) {
  const iAmP1 = m.p1?.clientId === clientId;
  const opp = iAmP1 ? m.p2 : m.p1;
  const youPresent = iAmP1 ? m.p1Present : m.p2Present;
  const oppPresent = iAmP1 ? m.p2Present : m.p1Present;
  const bothPresent = m.p1Present && m.p2Present;
  // No-show timer is shared (anchored to the round-start timestamp), so every
  // client counts down to the same instant.
  const noShowAt = m.activatedAt ? new Date(m.activatedAt).getTime() + (noShowMinutes ?? 10) * 60_000 : null;
  const remaining = useCountdown(noShowAt);
  const timeUp = remaining != null && remaining <= 0;
  const need = m.bestOf === 3 ? 2 : 1;
  // valid results from my perspective: (need, k) and (k, need) for k < need
  const wins = []; const losses = [];
  for (let k = 0; k < need; k++) { wins.push([need, k]); losses.push([k, need]); }
  const results = [...wins, ...losses.reverse()];

  const submit = ([myG, oppG]) => onReport(m.id, iAmP1 ? myG : oppG, iAmP1 ? oppG : myG);

  // what I already reported, in my own perspective → highlights the matching button
  const myGames = m.myReport ? (iAmP1 ? m.myReport.p1Score : m.myReport.p2Score) : null;
  const oppGames = m.myReport ? (iAmP1 ? m.myReport.p2Score : m.myReport.p1Score) : null;
  const isMine = (a, b) => myGames === a && oppGames === b;

  const waiting = m.status === 'reported_partial';
  const disputed = m.status === 'disputed';
  const undecided = opp && ['pending', 'reported_partial'].includes(m.status);

  return (
    <div style={{ ...partRow, flexDirection: 'column', alignItems: 'stretch', gap: 12, marginBottom: 18, padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 14, fontWeight: 800 }}>Your match</span>
        <StatusDot status={m.status} />
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Best of {m.bestOf}</span>
      </div>
      <div style={{ fontSize: 15 }}>
        <strong>You</strong> vs <strong>{opp ? opp.name : 'BYE'}</strong>
      </div>

      {/* Presence check-in — both confirm to officially start the match */}
      {undecided && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {bothPresent ? (
            <div style={{ fontSize: 12, fontWeight: 700, color: '#34d399' }}>
              ✓ Both players confirmed — match started.
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <PresenceTag label="You" present={youPresent} />
                <PresenceTag label={opp ? opp.name : 'Opponent'} present={oppPresent} />
              </div>
              {!youPresent && (
                <button onClick={() => onPresent(m.id)} disabled={busy}
                  style={{ ...resultBtn(false), alignSelf: 'flex-start', opacity: busy ? 0.5 : 1 }}>
                  I'm here — confirm presence
                </button>
              )}
              {!oppPresent && (
                <div style={{ fontSize: 12, color: timeUp ? '#f87171' : 'var(--text-muted)' }}>
                  {timeUp
                    ? `${opp ? opp.name : 'Opponent'} hasn't confirmed — you can report a no-show.`
                    : <>No-show timer for {opp ? opp.name : 'opponent'}: <strong style={{ fontFamily: 'var(--mono)', color: 'var(--text-secondary)' }}>{fmtMMSS(remaining ?? (noShowMinutes ?? 10) * 60)}</strong></>}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Open teamsheet — full cards (click a Pokémon to expand) */}
      {teamsheet === 'open' && m.opponentTeam && (
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 6 }}>OPPONENT TEAM</div>
          <TeamSheet team={m.opponentTeam} defaultExpanded />
        </div>
      )}
      {teamsheet === 'closed' && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Closed teamsheet — opponent's team is hidden.</div>}

      {disputed && <div style={{ ...errBox, marginBottom: 0 }}>Scores didn't match — the organizer will review and set the result.</div>}
      {waiting && <div style={{ fontSize: 12, color: '#fbbf24' }}>Your report is in — waiting for your opponent to confirm. Tap a different result to change it.</div>}

      {!disputed && (
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 6 }}>REPORT RESULT (your games – opponent games)</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {results.map(([a, b]) => (
              <button key={`${a}-${b}`} disabled={busy} onClick={() => submit([a, b])}
                style={{ ...resultBtn(isMine(a, b)), opacity: busy ? 0.5 : 1 }}>
                {a > b ? 'Win' : 'Loss'} {a}–{b}
              </button>
            ))}
          </div>
        </div>
      )}

      {undecided && !oppPresent && timeUp && (
        <button onClick={() => onNoShow(m.id)} disabled={busy}
          style={{ ...ghost, alignSelf: 'flex-start', color: '#f87171', borderColor: 'rgba(248,113,113,.3)', opacity: busy ? 0.5 : 1 }}>
          Report opponent no-show
        </button>
      )}
    </div>
  );
}

function ResolveCard({ m, onResolve, busy }) {
  const isNoShow = m.status === 'no_show_pending';
  const need = m.bestOf === 3 ? 2 : 1;
  const results = [];
  for (let k = 0; k < need; k++) { results.push([need, k]); }
  for (let k = need - 1; k >= 0; k--) { results.push([k, need]); }
  return (
    <div style={{ ...partRow, flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
      <div style={{ fontSize: 13 }}>
        <strong>{m.p1?.name}</strong> vs <strong>{m.p2?.name}</strong>
        <span style={{ fontSize: 10, color: isNoShow ? '#fbbf24' : '#f87171', marginLeft: 8, fontWeight: 700 }}>
          {isNoShow ? `NO-SHOW reported by ${m.noShowBy === m.p1?.clientId ? m.p1?.name : m.p2?.name}` : 'SCORE DISPUTE'}
        </span>
      </div>
      <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Set the official result ({m.p1?.name} – {m.p2?.name}):</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {results.map(([a, b]) => (
          <button key={`${a}-${b}`} disabled={busy} style={pill(false)}
            onClick={() => onResolve(m.id, { p1Score: a, p2Score: b })}>{a}–{b}</button>
        ))}
        {isNoShow && <button disabled={busy} style={ghost} onClick={() => onResolve(m.id, { dismiss: true })}>Dismiss</button>}
      </div>
    </div>
  );
}

function StandingsTable({ rows = [], final }) {
  if (!rows.length) return <Empty>No standings yet.</Empty>;
  return (
    <div style={{ marginTop: 8, border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
      {rows.map((r, i) => (
        <div key={r.clientId} style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', fontSize: 12,
          background: i % 2 ? 'var(--bg1)' : 'transparent',
          borderTop: i ? '1px solid var(--border)' : 'none',
        }}>
          <span style={{ width: 20, color: 'var(--text-muted)', fontWeight: 700 }}>
            {final && i < 3 ? ['🥇', '🥈', '🥉'][i] : (r.rank ?? i + 1)}
          </span>
          <span style={{ flex: 1, fontWeight: i === 0 && final ? 800 : 600, color: i === 0 && final ? 'var(--accent)' : 'inherit' }}>{r.name}</span>
          {r.wins != null && (
            <span style={{ color: 'var(--text-secondary)', fontFamily: 'var(--mono)' }}>
              {r.wins}-{r.losses}{r.byes ? `-${r.byes}b` : ''}{!final && r.matchPoints != null ? ` · ${r.matchPoints}pt` : ''}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function StatusDot({ status }) {
  const map = {
    pending: ['#94a3b8', 'pending'], reported_partial: ['#fbbf24', '1 report in'],
    disputed: ['#f87171', 'disputed'], no_show_pending: ['#fbbf24', 'no-show'],
    validated: ['#34d399', 'done'], walkover: ['#34d399', 'walkover'], bye: ['#64748b', 'bye'],
  };
  const [c, t] = map[status] || ['#94a3b8', status];
  return <span style={{ fontSize: 10, fontWeight: 700, color: c }}>● {t}</span>;
}

// ── Page shell ────────────────────────────────────────────────────────────────
export default function Tournament() {
  const clientId = getClientId();
  const [code, setCode] = useState(() => localStorage.getItem(ACTIVE_KEY) || null);
  const enter = (c) => { localStorage.setItem(ACTIVE_KEY, c); setCode(c); };
  const leave = () => { localStorage.removeItem(ACTIVE_KEY); setCode(null); };

  if (!code) return <CreateOrJoin onEnter={enter} clientId={clientId} />;
  return <Room code={code} clientId={clientId} onLeave={leave} />;
}

// ── bits ──────────────────────────────────────────────────────────────────────
function Field({ label, children, style }) {
  return (
    <div style={style}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.06em', color: 'var(--text-muted)', marginBottom: 6 }}>{label}</div>
      {children}
    </div>
  );
}
function SectionLabel({ children }) {
  return <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.08em', color: 'var(--text-muted)' }}>{children}</div>;
}
function BoToggle({ value, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      {[1, 3].map(n => <button key={n} onClick={() => onChange(n)} style={pill(value === n)}>Bo{n}</button>)}
    </div>
  );
}
function StatusPill({ status }) {
  const c = { lobby: '#fbbf24', running: 'var(--accent)', complete: '#34d399', closed: '#64748b', destroyed: '#f87171', abandoned: '#f87171' }[status] || 'var(--text-muted)';
  return <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.08em', color: c, border: `1px solid ${c}`, borderRadius: 6, padding: '2px 8px' }}>{status.toUpperCase()}</span>;
}
function TeamStatusTag({ status }) {
  const map = { none: ['NO TEAM', 'var(--text-muted)'], submitted: ['READY', '#34d399'], rejected: ['REJECTED', '#f87171'] };
  const [t, c] = map[status] || map.none;
  return <span style={{ fontSize: 10, fontWeight: 700, color: c }}>{t}</span>;
}
// Counts down to an absolute timestamp (ms). Returns whole seconds remaining
// (≥ 0), or null when no target is set. Anchored to a shared instant so every
// client shows the same time.
function useCountdown(targetMs) {
  const [, force] = useState(0);
  useEffect(() => {
    if (targetMs == null) return;
    const id = setInterval(() => force(n => n + 1), 500);
    return () => clearInterval(id);
  }, [targetMs]);
  if (targetMs == null) return null;
  return Math.max(0, Math.ceil((targetMs - Date.now()) / 1000));
}
function fmtMMSS(totalSecs) {
  const s = Math.max(0, totalSecs);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
function PresenceTag({ label, present }) {
  const c = present ? '#34d399' : 'var(--text-muted)';
  return (
    <span style={{ fontSize: 11, fontWeight: 700, color: c, border: `1px solid ${present ? 'rgba(52,211,153,.4)' : 'var(--border)'}`, borderRadius: 6, padding: '3px 9px' }}>
      {present ? '✓' : '○'} {label}
    </span>
  );
}
function bracketLabel(r) { return r === 0 ? 'Round 1' : `Bracket round ${r + 1}`; }
function Centered({ children }) { return <div style={{ maxWidth: 520, margin: '80px auto', textAlign: 'center' }}>{children}</div>; }
function Empty({ children }) { return <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '10px 0' }}>{children}</div>; }

// styles
const input = { background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-primary)', fontSize: 13, padding: '9px 11px', outline: 'none', width: '100%', fontFamily: 'inherit' };
const errBox = { color: '#f87171', fontSize: 12, marginBottom: 14, padding: '8px 12px', background: 'rgba(248,113,113,.08)', borderRadius: 8 };
const partRow = { display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg1)' };
const checkRow = { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-secondary)', cursor: 'pointer' };
const tabBtn = (a) => ({ padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer', border: `1px solid ${a ? 'var(--accent)' : 'var(--border)'}`, background: a ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'var(--bg2)', color: a ? 'var(--accent)' : 'var(--text-muted)' });
const cardBtn = (a) => ({ textAlign: 'left', padding: '12px 14px', borderRadius: 10, cursor: 'pointer', border: `1px solid ${a ? 'var(--accent)' : 'var(--border)'}`, background: a ? 'color-mix(in srgb, var(--accent) 8%, var(--bg1))' : 'var(--bg1)' });
const pill = (a) => ({ padding: '8px 16px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', textTransform: 'capitalize', border: `1px solid ${a ? 'var(--accent)' : 'var(--border)'}`, background: a ? 'color-mix(in srgb, var(--accent) 14%, transparent)' : 'var(--bg2)', color: a ? 'var(--accent)' : 'var(--text-muted)' });
// Report-result buttons: all green by default, the one you picked turns red.
const resultBtn = (selected) => ({ padding: '8px 14px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', border: `1px solid ${selected ? '#f87171' : '#34d399'}`, background: selected ? 'rgba(248,113,113,.16)' : 'rgba(52,211,153,.12)', color: selected ? '#f87171' : '#34d399' });
const primaryLg = (d) => ({ padding: '13px', borderRadius: 10, fontSize: 14, fontWeight: 800, width: '100%', border: '1px solid var(--accent)', background: 'color-mix(in srgb, var(--accent) 15%, transparent)', color: 'var(--accent)', cursor: d ? 'default' : 'pointer', opacity: d ? 0.5 : 1 });
const outlineLg = { padding: '11px 20px', borderRadius: 10, fontSize: 13, fontWeight: 700, border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text-secondary)', cursor: 'pointer' };
const ghost = { padding: '9px 16px', borderRadius: 8, fontSize: 12, fontWeight: 700, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer' };
const miniBtn = { padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700, border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text-secondary)', cursor: 'pointer' };
