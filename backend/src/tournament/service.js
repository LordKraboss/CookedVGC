// tournament/service.js
// Server-authoritative tournament operations. Every function takes an injected
// `db` (wrapDb handle) as its first argument so the layer is unit-testable.
//
// Layer 2 scope: schema + core lifecycle — create, join/reconnect, scoped state,
// team submit/review, destroy, and the stale sweep. Launch / pairings / scoring
// land in layers 3–5 (this file will grow).

const engine = require('./engine');
const store  = require('./store');

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous 0/O/1/I
const DEFAULT_NO_SHOW_MINUTES = 10;
const STALE_DAYS = 7;

function now() { return new Date().toISOString(); }

class TournamentError extends Error {
  constructor(message, code = 400) { super(message); this.status = code; }
}

function genCode(db, len = 4) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const code = Array.from({ length: len }, () =>
      CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join('');
    if (!store.getEvent(db, code)) return code;
  }
  return genCode(db, len + 1); // widen on the rare collision storm
}

// ── Create ──────────────────────────────────────────────────────────────────────
function createTournament(db, {
  name, regId = null, format, config = {},
  masterClientId, masterName = 'Organizer', masterPlays = false,
}) {
  store.ensureSchema(db);
  if (!masterClientId) throw new TournamentError('Missing masterClientId');

  const fullConfig = {
    ...config,
    name,
    noShowMinutes: config.noShowMinutes ?? DEFAULT_NO_SHOW_MINUTES,
  };
  // participantCount 0 → cap check is deferred to launch (we don't know the field yet)
  const { ok, errors } = engine.validateConfig(format, fullConfig, 0);
  if (!ok) throw new TournamentError('Invalid config: ' + errors.join('; '));

  const code = genCode(db);
  const ts = now();
  db.prepare(`
    INSERT INTO tour_events
      (code, name, reg_id, format, config_json, status, stage, current_round,
       master_client_id, master_plays, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'lobby', NULL, 0, ?, ?, ?, ?)
  `).run(code, name, regId, format, JSON.stringify(fullConfig),
         masterClientId, masterPlays ? 1 : 0, ts, ts);

  if (masterPlays) {
    db.prepare(`
      INSERT INTO tour_participants (code, client_id, display_name, team_status, status, joined_at)
      VALUES (?, ?, ?, 'none', 'lobby', ?)
    `).run(code, masterClientId, (masterName || 'Organizer').slice(0, 24), ts);
  }
  return { code };
}

// ── Join / reconnect ──────────────────────────────────────────────────────────────
// Idempotent: a known clientId reclaims its existing spot (reconnect). New joins
// are only allowed while the event is in `lobby`.
function joinTournament(db, code, clientId, name = 'Player') {
  store.ensureSchema(db);
  const ev = store.getEvent(db, code);
  if (!ev) throw new TournamentError('Tournament not found', 404);
  if (ev.status === 'destroyed' || ev.status === 'abandoned')
    throw new TournamentError('Tournament is no longer available', 410);
  if (ev.status === 'closed')
    throw new TournamentError('This tournament is closed — view it in Results', 410);
  if (!clientId) throw new TournamentError('Missing clientId');

  const existing = store.getParticipant(db, code, clientId);
  if (existing) {
    store.touchEvent(db, code, now());
    return getStateFor(db, code, clientId);
  }
  if (ev.status !== 'lobby')
    throw new TournamentError('Tournament already started — cannot join', 409);

  db.prepare(`
    INSERT INTO tour_participants (code, client_id, display_name, team_status, status, joined_at)
    VALUES (?, ?, ?, 'none', 'lobby', ?)
  `).run(code, clientId, (name || 'Player').slice(0, 24), now());
  store.touchEvent(db, code, now());
  return getStateFor(db, code, clientId);
}

// ── Team submit / review (lobby) ──────────────────────────────────────────────────
function submitTeam(db, code, clientId, team) {
  store.ensureSchema(db);
  const ev = store.getEvent(db, code);
  if (!ev) throw new TournamentError('Tournament not found', 404);
  if (ev.status !== 'lobby') throw new TournamentError('Teams are locked', 409);
  const p = store.getParticipant(db, code, clientId);
  if (!p) throw new TournamentError('You are not in this tournament', 403);

  db.prepare(`
    UPDATE tour_participants
    SET team_json = ?, team_status = 'submitted', reject_comment = NULL
    WHERE code = ? AND client_id = ?
  `).run(JSON.stringify(team ?? null), code, clientId);
  store.touchEvent(db, code, now());
  return getStateFor(db, code, clientId);
}

function rejectTeam(db, code, masterClientId, targetClientId, comment = '') {
  store.ensureSchema(db);
  const ev = requireMaster(db, code, masterClientId);
  if (ev.status !== 'lobby') throw new TournamentError('Teams are locked', 409);
  const p = store.getParticipant(db, code, targetClientId);
  if (!p) throw new TournamentError('Participant not found', 404);

  db.prepare(`
    UPDATE tour_participants
    SET team_status = 'rejected', reject_comment = ?
    WHERE code = ? AND client_id = ?
  `).run(String(comment || '').slice(0, 280), code, targetClientId);
  store.touchEvent(db, code, now());
  return getStateFor(db, code, masterClientId);
}

// ── Launch ──────────────────────────────────────────────────────────────────────
// Locks the field: only `submitted` players become `active`, the rest are dropped.
// Generates the first set of matches (RR/Swiss round 1, or the playoff bracket).
function bestOfForStage(config, format, stage) {
  if (format === 'swiss_playoff') return stage === 'playoff' ? config.playoffBestOf : config.swissBestOf;
  return config.bestOf;
}

function insertMatch(db, code, m) {
  // A real bye = a seeded player with no opponent. An empty bracket placeholder
  // (p1 still null, awaiting a winner) is NOT a bye — it's pending.
  const isBye = m.p1 != null && m.p2 == null;
  db.prepare(`
    INSERT INTO tour_matches
      (code, bracket_match_id, stage, round, bracket, table_no,
       p1_client_id, p2_client_id, best_of, winner_client_id, status,
       activated_at, next_match_id, loser_next_id, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    code, m.bracketMatchId ?? null, m.stage, m.round, m.bracket ?? null, m.tableNo,
    m.p1 ?? null, m.p2 ?? null, m.bestOf,
    isBye ? m.p1 : null,
    isBye ? 'bye' : 'pending',
    m.activate && !isBye ? now() : null,
    m.nextMatchId ?? null, m.loserNextId ?? null, now()
  );
}

function launch(db, code, masterClientId) {
  store.ensureSchema(db);
  const ev = requireMaster(db, code, masterClientId);
  if (ev.status !== 'lobby') throw new TournamentError('Tournament already launched', 409);

  const config = JSON.parse(ev.config_json);
  const all = store.getParticipants(db, code);
  const ready = all.filter(p => p.team_status === 'submitted');
  if (ready.length < 2) throw new TournamentError('Need at least 2 ready players to launch', 400);

  const { ok, errors } = engine.validateConfig(ev.format, config, ready.length);
  if (!ok) throw new TournamentError('Cannot launch: ' + errors.join('; '), 400);

  const stage = ev.format === 'playoff' ? 'playoff'
              : ev.format === 'round_robin' ? 'round_robin' : 'swiss';
  const bestOf = bestOfForStage(config, ev.format, stage);
  const ts = now();

  const tx = db.transaction(() => {
    // active vs dropped
    for (const p of all) {
      db.prepare('UPDATE tour_participants SET status = ? WHERE code = ? AND client_id = ?')
        .run(p.team_status === 'submitted' ? 'active' : 'dropped', code, p.client_id);
    }
    const activeIds = ready.map(p => p.client_id);

    if (stage === 'round_robin') {
      const schedule = engine.roundRobinSchedule(activeIds);
      schedule.forEach((round, ri) => round.forEach(([a, b], ti) =>
        insertMatch(db, code, { stage, round: ri + 1, tableNo: ti + 1, p1: a, p2: b, bestOf, activate: ri === 0 })));
    } else if (stage === 'swiss') {
      const order = engine.shuffle(activeIds); // initial seeding is random
      engine.swissPairings(order, new Set(), new Set()).forEach(([a, b], ti) =>
        insertMatch(db, code, { stage, round: 1, tableNo: ti + 1, p1: a, p2: b, bestOf, activate: true }));
    } else {
      // direct playoff — random placement into a power-of-two bracket
      const seeds = engine.shuffle(activeIds).slice(0, config.playoffSize);
      const built = config.playoffType === 'double'
        ? engine.buildDoubleElimination(seeds)
        : engine.buildSingleElimination(seeds, { thirdPlace: !!config.thirdPlace });
      built.matches.forEach((m, i) => insertMatch(db, code, {
        stage: 'playoff', round: m.round, bracket: m.bracket, tableNo: m.index + 1,
        bracketMatchId: m.id, p1: m.p1, p2: m.p2, bestOf,
        activate: m.p1 != null && m.p2 != null,
        nextMatchId: m.winnerTo ? `${m.winnerTo.id}:${m.winnerTo.slot}` : null,
        loserNextId: m.loserTo ? `${m.loserTo.id}:${m.loserTo.slot}` : null,
      }));
      db.prepare('UPDATE tour_events SET bracket_json = ? WHERE code = ?')
        .run(JSON.stringify({ type: built.type, finalId: built.finalId, thirdId: built.thirdId ?? null }), code);
    }

    db.prepare("UPDATE tour_events SET status='running', stage=?, current_round=1, updated_at=? WHERE code=?")
      .run(stage, ts, code);
  });
  tx();
  return getStateFor(db, code, masterClientId);
}

// ── Standings (live) ────────────────────────────────────────────────────────────
function activeParticipantIds(db, code) {
  return store.getParticipants(db, code)
    .filter(p => p.status === 'active' || p.status === 'eliminated')
    .map(p => p.client_id);
}

// Map decided DB matches into the engine's standings input. Only Swiss/RR matches
// count toward standings (playoff is elimination, not points).
function decidedMatchesForStandings(db, code) {
  return store.getMatches(db, code)
    .filter(m => m.stage === 'swiss' || m.stage === 'round_robin')
    .filter(m => m.status === 'validated' || m.status === 'walkover' || m.status === 'bye')
    .map(m => ({
      p1: m.p1_client_id, p2: m.p2_client_id,
      isBye: m.status === 'bye' || m.p2_client_id == null,
      winner: m.winner_client_id === m.p1_client_id ? 'p1' : 'p2',
      p1Score: m.p1_score ?? 0, p2Score: m.p2_score ?? 0,
    }));
}

function computeLiveStandings(db, code) {
  return engine.computeStandings(activeParticipantIds(db, code), decidedMatchesForStandings(db, code));
}

function decorateStandings(db, code, nameOf) {
  return computeLiveStandings(db, code).map(r => ({ ...r, name: nameOf[r.clientId] ?? r.clientId }));
}

// ── Match reporting & reconciliation ────────────────────────────────────────────
function loadActiveMatch(db, code, matchId) {
  const ev = store.getEvent(db, code);
  if (!ev) throw new TournamentError('Tournament not found', 404);
  if (ev.status !== 'running') throw new TournamentError('Tournament is not running', 409);
  const m = store.getMatch(db, code, matchId);
  if (!m) throw new TournamentError('Match not found', 404);
  return { ev, m };
}

// A player submits the game score (absolute orientation: p1Score = games won by p1).
function reportScore(db, code, matchId, clientId, p1Score, p2Score) {
  store.ensureSchema(db);
  const { m } = loadActiveMatch(db, code, matchId);
  if (clientId !== m.p1_client_id && clientId !== m.p2_client_id)
    throw new TournamentError('You are not in this match', 403);
  if (['validated', 'walkover', 'bye'].includes(m.status))
    throw new TournamentError('Match already decided', 409);
  if (!m.activated_at)
    throw new TournamentError('This match has not started yet — wait for the organizer to start the round', 409);

  const r = engine.resolveScore(m.best_of, p1Score, p2Score);
  if (!r.valid) throw new TournamentError(r.reason, 400);

  const report = { p1Score: Number(p1Score), p2Score: Number(p2Score) };
  const col = clientId === m.p1_client_id ? 'p1_report_json' : 'p2_report_json';
  db.prepare(`UPDATE tour_matches SET ${col} = ?, updated_at = ? WHERE id = ?`)
    .run(JSON.stringify(report), now(), m.id);

  const fresh = store.getMatch(db, code, matchId);
  const rep1 = fresh.p1_report_json ? JSON.parse(fresh.p1_report_json) : null;
  const rep2 = fresh.p2_report_json ? JSON.parse(fresh.p2_report_json) : null;

  if (rep1 && rep2) {
    if (engine.reportsAgree(rep1, rep2)) {
      finalizeMatch(db, code, fresh, rep1.p1Score, rep1.p2Score, 'validated');
    } else {
      db.prepare("UPDATE tour_matches SET status='disputed' WHERE id=?").run(m.id);
    }
  } else {
    db.prepare("UPDATE tour_matches SET status='reported_partial' WHERE id=?").run(m.id);
  }
  store.touchEvent(db, code, now());
  return getStateFor(db, code, clientId);
}

// A player confirms they are present for an activated match. This stops the
// no-show timer against them — an opponent who has confirmed presence can no
// longer be reported as a no-show. When both confirm, the match has officially started.
function markPresent(db, code, matchId, clientId) {
  store.ensureSchema(db);
  const { m } = loadActiveMatch(db, code, matchId);
  if (clientId !== m.p1_client_id && clientId !== m.p2_client_id)
    throw new TournamentError('You are not in this match', 403);
  if (['validated', 'walkover', 'bye'].includes(m.status))
    throw new TournamentError('Match already decided', 409);
  if (!m.activated_at) throw new TournamentError('Match has not started yet', 409);

  const col = clientId === m.p1_client_id ? 'p1_present_at' : 'p2_present_at';
  const already = clientId === m.p1_client_id ? m.p1_present_at : m.p2_present_at;
  if (!already) {
    db.prepare(`UPDATE tour_matches SET ${col} = ?, updated_at = ? WHERE id = ?`).run(now(), now(), m.id);
    store.touchEvent(db, code, now());
  }
  return getStateFor(db, code, clientId);
}

// Present player flags an absent opponent — after the no-show timer. TO confirms.
function reportNoShow(db, code, matchId, clientId) {
  store.ensureSchema(db);
  const { ev, m } = loadActiveMatch(db, code, matchId);
  if (clientId !== m.p1_client_id && clientId !== m.p2_client_id)
    throw new TournamentError('You are not in this match', 403);
  if (m.status === 'validated' || m.status === 'walkover' || m.status === 'bye')
    throw new TournamentError('Match already decided', 409);
  if (!m.activated_at) throw new TournamentError('Match has not started yet', 409);

  const oppPresent = clientId === m.p1_client_id ? m.p2_present_at : m.p1_present_at;
  if (oppPresent) throw new TournamentError('Your opponent has confirmed they are present', 409);

  const config = JSON.parse(ev.config_json);
  const mins = config.noShowMinutes ?? DEFAULT_NO_SHOW_MINUTES;
  const elapsed = Date.now() - new Date(m.activated_at).getTime();
  if (elapsed < mins * 60_000)
    throw new TournamentError(`You can report a no-show after ${mins} minutes`, 409);

  db.prepare("UPDATE tour_matches SET status='no_show_pending', no_show_by=?, updated_at=? WHERE id=?")
    .run(clientId, now(), m.id);
  store.touchEvent(db, code, now());
  return getStateFor(db, code, clientId);
}

// Master override: set the score (resolve a dispute / confirm a walkover) or
// dismiss a pending no-show back to play.
function resolveMatch(db, code, masterClientId, matchId, { p1Score, p2Score, dismiss } = {}) {
  store.ensureSchema(db);
  const ev = requireMaster(db, code, masterClientId);
  const m = store.getMatch(db, code, matchId);
  if (!m) throw new TournamentError('Match not found', 404);
  if (['validated', 'walkover', 'bye'].includes(m.status)) {
    // Organizer may correct an already-decided result, but only for a
    // Swiss/RR match in the CURRENT round (before advancing) — editing past
    // rounds or a playoff result would desync pairings/the bracket.
    const editable = m.status !== 'bye'
      && (m.stage === 'swiss' || m.stage === 'round_robin')
      && m.stage === ev.stage && m.round === ev.current_round;
    if (!editable) throw new TournamentError('This result can no longer be changed', 409);
  }

  if (dismiss) {
    db.prepare("UPDATE tour_matches SET status='pending', no_show_by=NULL, updated_at=? WHERE id=?")
      .run(now(), m.id);
    store.touchEvent(db, code, now());
    return getStateFor(db, code, masterClientId);
  }

  const r = engine.resolveScore(m.best_of, p1Score, p2Score);
  if (!r.valid) throw new TournamentError(r.reason, 400);
  const finalStatus = m.no_show_by ? 'walkover' : 'validated';
  finalizeMatch(db, code, m, Number(p1Score), Number(p2Score), finalStatus);
  store.touchEvent(db, code, now());
  return getStateFor(db, code, masterClientId);
}

// Write the decided result, then advance the playoff bracket and check completion.
function finalizeMatch(db, code, m, p1Score, p2Score, status) {
  const winner = p1Score > p2Score ? m.p1_client_id : m.p2_client_id;
  const loser  = winner === m.p1_client_id ? m.p2_client_id : m.p1_client_id;
  db.prepare(`
    UPDATE tour_matches
    SET p1_score=?, p2_score=?, winner_client_id=?, status=?, updated_at=?
    WHERE id=?
  `).run(p1Score, p2Score, winner, status, now(), m.id);

  if (m.stage === 'playoff') {
    advancePlayoff(db, code, m, winner, loser);
    // eliminate the loser (unless they drop into the losers bracket — handled by ref)
    if (!m.loser_next_id && loser) {
      db.prepare("UPDATE tour_participants SET status='eliminated' WHERE code=? AND client_id=?").run(code, loser);
    }
  }
  checkComplete(db, code);
}

// Route winner/loser into their downstream playoff slots; activate when filled.
function advancePlayoff(db, code, m, winner, loser) {
  const place = (ref, playerId) => {
    if (!ref || !playerId) return;
    const [bid, slotStr] = ref.split(':');
    const slot = Number(slotStr);
    const target = db.prepare('SELECT * FROM tour_matches WHERE code=? AND bracket_match_id=?').get(code, bid);
    if (!target) return;
    const col = slot === 1 ? 'p1_client_id' : 'p2_client_id';
    db.prepare(`UPDATE tour_matches SET ${col}=? WHERE id=?`).run(playerId, target.id);
    const fresh = store.getMatch(db, code, target.id);
    if (fresh.p1_client_id && fresh.p2_client_id && !fresh.activated_at && fresh.status === 'pending') {
      db.prepare('UPDATE tour_matches SET activated_at=? WHERE id=?').run(now(), target.id);
    }
  };
  place(m.next_match_id, winner);
  place(m.loser_next_id, loser);
}

// ── Drop a participant (master) ─────────────────────────────────────────────────
function dropParticipant(db, code, masterClientId, targetClientId) {
  store.ensureSchema(db);
  requireMaster(db, code, masterClientId);
  const p = store.getParticipant(db, code, targetClientId);
  if (!p) throw new TournamentError('Participant not found', 404);

  db.prepare("UPDATE tour_participants SET status='dropped' WHERE code=? AND client_id=?")
    .run(code, targetClientId);

  // Forfeit all their not-yet-decided matches to the opponent.
  const open = store.getMatches(db, code).filter(m =>
    (m.p1_client_id === targetClientId || m.p2_client_id === targetClientId) &&
    !['validated', 'walkover', 'bye'].includes(m.status));
  for (const m of open) {
    const opp = m.p1_client_id === targetClientId ? m.p2_client_id : m.p1_client_id;
    if (!opp) { // their bye match — just void it
      db.prepare("UPDATE tour_matches SET status='bye', winner_client_id=NULL WHERE id=?").run(m.id);
      continue;
    }
    const oppIsP1 = opp === m.p1_client_id;
    const need = m.best_of === 3 ? 2 : 1;
    finalizeMatch(db, code, m, oppIsP1 ? need : 0, oppIsP1 ? 0 : need, 'walkover');
  }
  store.touchEvent(db, code, now());
  return getStateFor(db, code, masterClientId);
}

// ── Advance round (master) ──────────────────────────────────────────────────────
// RR: activate the next pre-built round. Swiss: generate the next round (or build
// the playoff after the final Swiss round). Playoff advances itself on each result.
function advance(db, code, masterClientId) {
  store.ensureSchema(db);
  const ev = requireMaster(db, code, masterClientId);
  if (ev.status !== 'running') throw new TournamentError('Not running', 409);
  const config = JSON.parse(ev.config_json);

  const cur = store.getMatches(db, code).filter(m => m.stage === ev.stage && m.round === ev.current_round);
  const unresolved = cur.filter(m => !['validated', 'walkover', 'bye'].includes(m.status));
  if (unresolved.length) throw new TournamentError('Finish all matches in the current round first', 409);

  if (ev.stage === 'round_robin') {
    const totalRounds = Math.max(0, ...store.getMatches(db, code).map(m => m.round));
    if (ev.current_round >= totalRounds) { checkComplete(db, code); return getStateFor(db, code, masterClientId); }
    const next = ev.current_round + 1;
    db.prepare("UPDATE tour_matches SET activated_at=? WHERE code=? AND stage='round_robin' AND round=? AND status='pending'")
      .run(now(), code, next);
    db.prepare("UPDATE tour_events SET current_round=?, updated_at=? WHERE code=?").run(next, now(), code);
  } else if (ev.stage === 'swiss') {
    if (ev.current_round >= config.swissRounds) {
      // Swiss is over → playoff (combo) or complete.
      if (ev.format === 'swiss_playoff') return startPlayoffFromSwiss(db, code, config, masterClientId);
      checkComplete(db, code, true);
      return getStateFor(db, code, masterClientId);
    }
    generateNextSwissRound(db, code, config, ev.current_round + 1);
  }
  // playoff: nothing to do — it advances on each finalize.
  store.touchEvent(db, code, now());
  return getStateFor(db, code, masterClientId);
}

function generateNextSwissRound(db, code, config, roundNo) {
  const standings = computeLiveStandings(db, code).map(r => r.clientId);
  const matches = store.getMatches(db, code);
  const history = new Set();
  const byes = new Set();
  for (const m of matches) {
    if (m.p2_client_id) history.add(engine.pairKey(m.p1_client_id, m.p2_client_id));
    if (m.status === 'bye') byes.add(m.p1_client_id);
  }
  const fmt = store.getEvent(db, code).format;
  const bestOf = bestOfForStage(config, fmt, 'swiss');
  engine.swissPairings(standings, history, byes).forEach(([a, b], ti) =>
    insertMatch(db, code, { stage: 'swiss', round: roundNo, tableNo: ti + 1, p1: a, p2: b, bestOf, activate: true }));
  db.prepare("UPDATE tour_events SET current_round=?, updated_at=? WHERE code=?").run(roundNo, now(), code);
}

function startPlayoffFromSwiss(db, code, config, masterClientId) {
  const standings = computeLiveStandings(db, code);
  const seeds = standings.slice(0, config.playoffSize).map(r => r.clientId);
  const built = engine.buildSingleElimination(seeds, { thirdPlace: !!config.thirdPlace }); // combo = single elim
  const bestOf = bestOfForStage(config, 'swiss_playoff', 'playoff');
  // record seeds
  seeds.forEach((id, i) => db.prepare('UPDATE tour_participants SET seed=? WHERE code=? AND client_id=?').run(i + 1, code, id));
  built.matches.forEach(m => insertMatch(db, code, {
    stage: 'playoff', round: m.round, bracket: m.bracket, tableNo: m.index + 1,
    bracketMatchId: m.id, p1: m.p1, p2: m.p2, bestOf,
    activate: m.p1 != null && m.p2 != null,
    nextMatchId: m.winnerTo ? `${m.winnerTo.id}:${m.winnerTo.slot}` : null,
    loserNextId: m.loserTo ? `${m.loserTo.id}:${m.loserTo.slot}` : null,
  }));
  db.prepare("UPDATE tour_events SET stage='playoff', current_round=0, bracket_json=?, updated_at=? WHERE code=?")
    .run(JSON.stringify({ type: built.type, finalId: built.finalId, thirdId: built.thirdId ?? null }), now(), code);
  return getStateFor(db, code, masterClientId);
}

// ── Completion ──────────────────────────────────────────────────────────────────
function checkComplete(db, code, forceSwissEnd = false) {
  const ev = store.getEvent(db, code);
  if (!ev || ev.status !== 'running') return;
  const matches = store.getMatches(db, code);
  const allDone = matches.every(m => ['validated', 'walkover', 'bye'].includes(m.status));

  let done = false;
  if (ev.stage === 'playoff') {
    const bracket = ev.bracket_json ? JSON.parse(ev.bracket_json) : null;
    const finalRow = bracket && matches.find(m => m.bracket_match_id === bracket.finalId);
    const thirdRow = bracket && bracket.thirdId ? matches.find(m => m.bracket_match_id === bracket.thirdId) : null;
    const finalDone = finalRow && ['validated', 'walkover'].includes(finalRow.status);
    const thirdDone = !thirdRow || ['validated', 'walkover', 'bye'].includes(thirdRow.status);
    done = !!finalDone && thirdDone;
  } else if (ev.stage === 'round_robin') {
    const totalRounds = Math.max(0, ...matches.map(m => m.round));
    done = allDone && ev.current_round >= totalRounds;
  } else if (ev.stage === 'swiss') {
    const config = JSON.parse(ev.config_json);
    done = forceSwissEnd || (allDone && ev.current_round >= config.swissRounds && ev.format === 'swiss');
  }

  if (done) {
    const nameOf = Object.fromEntries(store.getParticipants(db, code).map(p => [p.client_id, p.display_name]));
    const standings = ev.stage === 'playoff'
      ? finalPlayoffStandings(db, code, nameOf)
      : decorateStandings(db, code, nameOf);
    db.prepare("UPDATE tour_events SET status='complete', completed_at=?, final_standings_json=?, updated_at=? WHERE code=?")
      .run(now(), JSON.stringify(standings), now(), code);
  }
}

// Final placement for a bracket: champion, runner-up, 3rd (if a 3rd-place match),
// then everyone else by Swiss/seed order.
function finalPlayoffStandings(db, code, nameOf) {
  const ev = store.getEvent(db, code);
  const bracket = ev.bracket_json ? JSON.parse(ev.bracket_json) : {};
  const matches = store.getMatches(db, code);
  const final = matches.find(m => m.bracket_match_id === bracket.finalId);
  const third = bracket.thirdId ? matches.find(m => m.bracket_match_id === bracket.thirdId) : null;

  const order = [];
  if (final?.winner_client_id) order.push(final.winner_client_id);
  if (final) { const ru = final.winner_client_id === final.p1_client_id ? final.p2_client_id : final.p1_client_id; if (ru) order.push(ru); }
  if (third?.winner_client_id) order.push(third.winner_client_id);

  // append remaining participants by their live standings (seed/Swiss)
  const liveRows = computeLiveStandings(db, code);
  const recMap = Object.fromEntries(liveRows.map(r => [r.clientId, r]));
  for (const r of liveRows) if (!order.includes(r.clientId)) order.push(r.clientId);
  // and any not captured at all
  for (const p of store.getParticipants(db, code)) if (p.status !== 'dropped' && !order.includes(p.client_id)) order.push(p.client_id);

  return order.map((id, i) => ({
    rank: i + 1, clientId: id, name: nameOf[id] ?? id,
    wins: recMap[id]?.wins, losses: recMap[id]?.losses, byes: recMap[id]?.byes,
    matchPoints: recMap[id]?.matchPoints,
  }));
}

// ── Complete (organizer ends the event, keeping the results) ───────────────────────
function completeTournament(db, code, masterClientId) {
  store.ensureSchema(db);
  const ev = requireMaster(db, code, masterClientId);
  if (ev.status === 'complete') return getStateFor(db, code, masterClientId);
  if (ev.status !== 'running') throw new TournamentError('Tournament is not running', 409);

  const nameOf = Object.fromEntries(store.getParticipants(db, code).map(p => [p.client_id, p.display_name]));
  const standings = ev.stage === 'playoff'
    ? finalPlayoffStandings(db, code, nameOf)
    : decorateStandings(db, code, nameOf);
  const ts = now();
  db.prepare("UPDATE tour_events SET status='complete', completed_at=?, final_standings_json=?, updated_at=? WHERE code=?")
    .run(ts, JSON.stringify(standings), ts, code);
  return getStateFor(db, code, masterClientId);
}

// ── Close (organizer saves result and frees the room) ─────────────────────────────
function closeTournament(db, code, masterClientId) {
  store.ensureSchema(db);
  const ev = requireMaster(db, code, masterClientId);
  if (ev.status !== 'complete') throw new TournamentError('Tournament is not complete', 409);
  db.prepare("UPDATE tour_events SET status='closed', updated_at=? WHERE code=?").run(now(), code);
  return { ok: true };
}

// ── Destroy ───────────────────────────────────────────────────────────────────────
function destroyTournament(db, code, masterClientId) {
  store.ensureSchema(db);
  requireMaster(db, code, masterClientId);
  store.deleteChildren(db, code);
  db.prepare("UPDATE tour_events SET status = 'destroyed', updated_at = ? WHERE code = ?")
    .run(now(), code);
  return { ok: true };
}

// ── Stale sweep (cron) ──────────────────────────────────────────────────────────────
// Abandon + prune lobby/running events with no activity for `staleDays`.
function sweepStale(db, staleDays = STALE_DAYS, nowIso = now()) {
  store.ensureSchema(db);
  const cutoff = new Date(new Date(nowIso).getTime() - staleDays * 86400_000).toISOString();
  const stale = db.prepare(`
    SELECT code FROM tour_events
    WHERE status IN ('lobby','running','complete') AND updated_at < ?
  `).all(cutoff);
  for (const { code } of stale) {
    store.deleteChildren(db, code);
    db.prepare("UPDATE tour_events SET status = 'abandoned', updated_at = ? WHERE code = ?")
      .run(nowIso, code);
  }
  return { abandoned: stale.map(s => s.code) };
}

// ── Helpers ───────────────────────────────────────────────────────────────────────
function requireMaster(db, code, clientId) {
  const ev = store.getEvent(db, code);
  if (!ev) throw new TournamentError('Tournament not found', 404);
  if (ev.master_client_id !== clientId)
    throw new TournamentError('Only the organizer can do that', 403);
  return ev;
}

// Build a state view scoped to `requesterClientId`. Team contents are visible only
// to (a) the player themselves and (b) the organizer when he is NOT playing (so he
// can review). Opponent-teamsheet reveal during a match is handled in the match layer.
function getStateFor(db, code, requesterClientId = null) {
  store.ensureSchema(db);
  const ev = store.getEvent(db, code);
  if (!ev) throw new TournamentError('Tournament not found', 404);

  const config = JSON.parse(ev.config_json);
  const isMaster = requesterClientId === ev.master_client_id;
  const masterReviewer = isMaster && ev.master_plays === 0;

  const nameOf = {};
  const teamOf = {};
  const rawParts = store.getParticipants(db, code);
  for (const p of rawParts) { nameOf[p.client_id] = p.display_name; teamOf[p.client_id] = p.team_json; }

  // Match list. Teamsheet content is revealed only when `open` and the requester
  // is one of the two players in that (still-active) match.
  const matches = store.getMatches(db, code).map(m => {
    const youAreIn = requesterClientId === m.p1_client_id || requesterClientId === m.p2_client_id;
    const oppId = m.p1_client_id === requesterClientId ? m.p2_client_id : m.p1_client_id;
    const showOpp = youAreIn && config.teamsheet === 'open' && oppId && teamOf[oppId];
    const myRepRaw = requesterClientId === m.p1_client_id ? m.p1_report_json
                   : requesterClientId === m.p2_client_id ? m.p2_report_json : null;
    return {
      id: m.id,
      stage: m.stage, round: m.round, bracket: m.bracket, tableNo: m.table_no,
      bestOf: m.best_of, status: m.status,
      p1: m.p1_client_id ? { clientId: m.p1_client_id, name: nameOf[m.p1_client_id] } : null,
      p2: m.p2_client_id ? { clientId: m.p2_client_id, name: nameOf[m.p2_client_id] } : null,
      p1Score: m.p1_score, p2Score: m.p2_score,
      winnerClientId: m.winner_client_id,
      activatedAt: m.activated_at,
      p1Present: !!m.p1_present_at,
      p2Present: !!m.p2_present_at,
      noShowBy: m.no_show_by,
      // open-teamsheet opponent reveal (per-requester)
      opponentTeam: showOpp ? JSON.parse(teamOf[oppId]) : null,
      myReport: myRepRaw ? JSON.parse(myRepRaw) : null,
      youAreIn,
    };
  });

  const participants = rawParts.map(p => {
    const canSeeTeam = masterReviewer || p.client_id === requesterClientId;
    return {
      clientId: p.client_id,
      name: p.display_name,
      teamStatus: p.team_status,
      status: p.status,
      seed: p.seed,
      rejectComment: p.client_id === requesterClientId ? p.reject_comment : (masterReviewer ? p.reject_comment : null),
      team: canSeeTeam && p.team_json ? JSON.parse(p.team_json) : null,
      hasTeam: !!p.team_json,
    };
  });

  return {
    code: ev.code,
    name: ev.name,
    regId: ev.reg_id,
    format: ev.format,
    config,
    status: ev.status,
    stage: ev.stage,
    currentRound: ev.current_round,
    masterClientId: ev.master_client_id,
    masterPlays: ev.master_plays === 1,
    you: {
      clientId: requesterClientId,
      isMaster,
      isParticipant: participants.some(p => p.clientId === requesterClientId),
    },
    participants,
    matches,
    standings: ev.status === 'lobby' ? [] : decorateStandings(db, code, nameOf),
    finalStandings: ev.final_standings_json ? JSON.parse(ev.final_standings_json) : null,
    createdAt: ev.created_at,
    updatedAt: ev.updated_at,
    completedAt: ev.completed_at,
  };
}

// Archive list (completed events) + one archived event.
function listResults(db) {
  store.ensureSchema(db);
  return db.prepare(`
    SELECT code, name, reg_id, format, completed_at,
           (SELECT COUNT(*) FROM tour_participants p WHERE p.code = e.code) AS players
    FROM tour_events e
    WHERE status IN ('complete','closed')
    ORDER BY completed_at DESC
  `).all();
}

// Full detail for one completed event — final standings, every set, and teams.
// (The event is over, so the archive shows all sets regardless of teamsheet mode.)
function getResultDetail(db, code) {
  store.ensureSchema(db);
  const ev = store.getEvent(db, code);
  if (!ev) throw new TournamentError('Tournament not found', 404);
  if (ev.status !== 'complete' && ev.status !== 'closed') throw new TournamentError('Tournament is not complete', 409);

  const parts = store.getParticipants(db, code);
  const nameOf = Object.fromEntries(parts.map(p => [p.client_id, p.display_name]));
  const config = JSON.parse(ev.config_json);

  const matches = store.getMatches(db, code).map(m => ({
    id: m.id, stage: m.stage, round: m.round, bracket: m.bracket, tableNo: m.table_no,
    bestOf: m.best_of, status: m.status,
    p1: m.p1_client_id ? { clientId: m.p1_client_id, name: nameOf[m.p1_client_id] } : null,
    p2: m.p2_client_id ? { clientId: m.p2_client_id, name: nameOf[m.p2_client_id] } : null,
    p1Score: m.p1_score, p2Score: m.p2_score, winnerClientId: m.winner_client_id,
  }));

  return {
    code: ev.code, name: ev.name, regId: ev.reg_id, format: ev.format, config,
    completedAt: ev.completed_at, createdAt: ev.created_at,
    finalStandings: ev.final_standings_json ? JSON.parse(ev.final_standings_json) : [],
    participants: parts.map(p => ({
      clientId: p.client_id, name: p.display_name, seed: p.seed, status: p.status,
      team: p.team_json ? JSON.parse(p.team_json) : null,
    })),
    matches,
  };
}

module.exports = {
  TournamentError, STALE_DAYS, DEFAULT_NO_SHOW_MINUTES,
  genCode,
  createTournament, joinTournament,
  submitTeam, rejectTeam, launch,
  reportScore, markPresent, reportNoShow, resolveMatch, dropParticipant, advance,
  completeTournament, closeTournament, destroyTournament, sweepStale,
  getStateFor, listResults, getResultDetail, computeLiveStandings,
  requireMaster,
};
