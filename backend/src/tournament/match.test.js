// tournament/match.test.js — reporting, reconciliation, no-show, drop, advance,
// playoff progression, completion.  run with: node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const initSqlJs = require('sql.js');
const { wrapDb } = require('../db/schema');
const S = require('./service');
const store = require('./store');

async function mkDb() { const SQL = await initSqlJs(); return wrapDb(new SQL.Database()); }

async function ready(db, format, config, n) {
  const { code } = S.createTournament(db, { name: 'Cup', masterClientId: 'm', format, config });
  for (let i = 1; i <= n; i++) { S.joinTournament(db, code, `p${i}`, `P${i}`); S.submitTeam(db, code, `p${i}`, [{ name: 'x' }]); }
  return code;
}
const state = (db, code) => S.getStateFor(db, code, 'm');
const roundMatches = (db, code, round) => state(db, code).matches.filter(m => m.round === round && m.stage !== undefined);

// Both players report the same score (auto-validates).
function bothReport(db, code, m, a, b) {
  S.reportScore(db, code, m.id, m.p1.clientId, a, b);
  if (m.p2) S.reportScore(db, code, m.id, m.p2.clientId, a, b);
}

test('round robin: full event reports, advances, completes with standings', async () => {
  const db = await mkDb();
  const code = await ready(db, 'round_robin', { bestOf: 3, teamsheet: 'open' }, 4);
  S.launch(db, code, 'm');

  let st = state(db, code);
  const totalRounds = Math.max(...st.matches.map(m => m.round));
  assert.equal(totalRounds, 3);

  for (let r = 1; r <= totalRounds; r++) {
    for (const m of state(db, code).matches.filter(x => x.round === r)) {
      if (m.status === 'bye') continue;
      bothReport(db, code, m, 2, 1); // p1 wins each
    }
    if (r < totalRounds) S.advance(db, code, 'm');
  }
  st = state(db, code);
  assert.equal(st.status, 'complete');
  assert.ok(st.finalStandings.length === 4);
  assert.ok(st.finalStandings[0].rank === 1);
});

test('round robin: future (non-activated) rounds cannot be reported', async () => {
  const db = await mkDb();
  const code = await ready(db, 'round_robin', { bestOf: 3, teamsheet: 'closed' }, 4);
  S.launch(db, code, 'm');
  const st = state(db, code);
  // a round-2 match exists but isn't activated yet
  const future = st.matches.find(m => m.round === 2 && m.p1 && m.p2);
  assert.ok(future && !future.activatedAt, 'round 2 should be dormant at launch');
  assert.throws(() => S.reportScore(db, code, future.id, future.p1.clientId, 2, 0), /not started/);
  // its players also shouldn't see it as their live match in state
  const asP1 = S.getStateFor(db, code, future.p1.clientId);
  const live = asP1.matches.find(m => m.youAreIn && m.activatedAt && !['validated','walkover','bye'].includes(m.status));
  assert.equal(live.round, 1, 'only the activated round-1 match is live');
});

test('reporting: disagreement disputes, master resolves', async () => {
  const db = await mkDb();
  const code = await ready(db, 'round_robin', { bestOf: 3, teamsheet: 'closed' }, 2);
  S.launch(db, code, 'm');
  const m = state(db, code).matches[0];
  S.reportScore(db, code, m.id, m.p1.clientId, 2, 0);
  S.reportScore(db, code, m.id, m.p2.clientId, 2, 1); // disagree
  assert.equal(store.getMatch(db, code, m.id).status, 'disputed');
  // master sets the truth
  S.resolveMatch(db, code, 'm', m.id, { p1Score: 2, p2Score: 1 });
  const fixed = store.getMatch(db, code, m.id);
  assert.equal(fixed.status, 'validated');
  assert.equal(fixed.winner_client_id, m.p1.clientId);
});

test('report validation rejects impossible scores', async () => {
  const db = await mkDb();
  const code = await ready(db, 'round_robin', { bestOf: 3, teamsheet: 'closed' }, 2);
  S.launch(db, code, 'm');
  const m = state(db, code).matches[0];
  assert.throws(() => S.reportScore(db, code, m.id, m.p1.clientId, 2, 2), /threshold/);
  assert.throws(() => S.reportScore(db, code, m.id, 'stranger', 2, 0), /not in this match/);
});

test('no-show: blocked before timer, then master confirms walkover', async () => {
  const db = await mkDb();
  const code = await ready(db, 'round_robin', { bestOf: 1, teamsheet: 'closed', noShowMinutes: 10 }, 2);
  S.launch(db, code, 'm');
  const m = state(db, code).matches[0];
  assert.throws(() => S.reportNoShow(db, code, m.id, m.p1.clientId), /after 10 minutes/);
  // backdate activation past the timer
  db.prepare("UPDATE tour_matches SET activated_at='2000-01-01T00:00:00.000Z' WHERE id=?").run(m.id);
  S.reportNoShow(db, code, m.id, m.p1.clientId);
  assert.equal(store.getMatch(db, code, m.id).status, 'no_show_pending');
  // master confirms walkover to the present player (p1)
  S.resolveMatch(db, code, 'm', m.id, { p1Score: 1, p2Score: 0 });
  const r = store.getMatch(db, code, m.id);
  assert.equal(r.status, 'walkover');
  assert.equal(r.winner_client_id, m.p1.clientId);
});

test('presence: opponent confirming presence blocks a no-show report', async () => {
  const db = await mkDb();
  const code = await ready(db, 'round_robin', { bestOf: 1, teamsheet: 'closed', noShowMinutes: 10 }, 2);
  S.launch(db, code, 'm');
  const m = state(db, code).matches[0];
  // backdate activation past the timer so timing is no longer the blocker
  db.prepare("UPDATE tour_matches SET activated_at='2000-01-01T00:00:00.000Z' WHERE id=?").run(m.id);
  // p2 confirms presence → p1 can no longer report p2 as a no-show
  S.markPresent(db, code, m.id, m.p2.clientId);
  assert.throws(() => S.reportNoShow(db, code, m.id, m.p1.clientId), /confirmed they are present/);
  // presence is reflected in scoped state for both players
  const stP1 = S.getStateFor(db, code, m.p1.clientId);
  const mine = stP1.matches.find(x => x.id === m.id);
  assert.equal(mine.p2Present, true);
  assert.equal(mine.p1Present, false);
  // once p1 also confirms, both are present
  S.markPresent(db, code, m.id, m.p1.clientId);
  assert.equal(store.getMatch(db, code, m.id).p1_present_at != null, true);
});

test('no-show: master can dismiss back to play', async () => {
  const db = await mkDb();
  const code = await ready(db, 'round_robin', { bestOf: 1, teamsheet: 'closed' }, 2);
  S.launch(db, code, 'm');
  const m = state(db, code).matches[0];
  db.prepare("UPDATE tour_matches SET activated_at='2000-01-01T00:00:00.000Z' WHERE id=?").run(m.id);
  S.reportNoShow(db, code, m.id, m.p1.clientId);
  S.resolveMatch(db, code, 'm', m.id, { dismiss: true });
  assert.equal(store.getMatch(db, code, m.id).status, 'pending');
});

test('drop: forfeits the dropped player\'s open matches to opponents', async () => {
  const db = await mkDb();
  const code = await ready(db, 'round_robin', { bestOf: 3, teamsheet: 'closed' }, 4);
  S.launch(db, code, 'm');
  S.dropParticipant(db, code, 'm', 'p2');
  const st = state(db, code);
  assert.equal(st.participants.find(p => p.clientId === 'p2').status, 'dropped');
  // every match involving p2 is now decided in the opponent's favour
  for (const mm of st.matches.filter(x => x.p1?.clientId === 'p2' || x.p2?.clientId === 'p2')) {
    assert.ok(['walkover', 'bye'].includes(mm.status));
    if (mm.status === 'walkover') assert.notEqual(mm.winnerClientId, 'p2');
  }
});

test('playoff: single-elim of 4 advances winners and crowns a champion', async () => {
  const db = await mkDb();
  const code = await ready(db, 'playoff',
    { playoffSize: 4, playoffType: 'single', bestOf: 3, teamsheet: 'closed', thirdPlace: true }, 4);
  S.launch(db, code, 'm');
  // semis are round 0 W matches
  let semis = state(db, code).matches.filter(m => m.bracket === 'W' && m.round === 0);
  assert.equal(semis.length, 2);
  const semiWinners = [];
  for (const sm of semis) { bothReport(db, code, sm, 2, 0); semiWinners.push(sm.p1.clientId); }

  // final + third place should now be populated and active
  const after = state(db, code);
  const final = after.matches.find(m => m.bracket === 'W' && m.round === 1);
  const third = after.matches.find(m => m.bracket === 'TP');
  assert.ok(final.p1 && final.p2, 'final seeded from semi winners');
  assert.ok(third.p1 && third.p2, 'third place seeded from semi losers');

  bothReport(db, code, third, 2, 0);
  bothReport(db, code, final, 2, 1);
  const done = state(db, code);
  assert.equal(done.status, 'complete');
  assert.equal(done.finalStandings[0].clientId, final.p1.clientId); // champion = final p1
  assert.equal(done.finalStandings.length >= 3, true);
});

test('organizer can edit a validated current-round result before advancing', async () => {
  const db = await mkDb();
  const code = await ready(db, 'round_robin', { bestOf: 3, teamsheet: 'closed' }, 2);
  S.launch(db, code, 'm');
  const m = state(db, code).matches[0];
  bothReport(db, code, m, 2, 0); // p1 wins
  assert.equal(store.getMatch(db, code, m.id).winner_client_id, m.p1.clientId);
  // organizer corrects it → p2 wins
  S.resolveMatch(db, code, 'm', m.id, { p1Score: 1, p2Score: 2 });
  const fixed = store.getMatch(db, code, m.id);
  assert.equal(fixed.status, 'validated');
  assert.equal(fixed.winner_client_id, m.p2.clientId);
});

test('completeTournament finalizes early and keeps standings', async () => {
  const db = await mkDb();
  const code = await ready(db, 'swiss', { swissRounds: 5, bestOf: 1, teamsheet: 'closed' }, 4);
  S.launch(db, code, 'm');
  // play just round 1
  for (const mm of state(db, code).matches.filter(x => x.round === 1)) if (mm.status !== 'bye') bothReport(db, code, mm, 1, 0);
  const st = S.completeTournament(db, code, 'm');
  assert.equal(st.status, 'complete');
  assert.ok(st.finalStandings.length === 4);
  assert.ok(st.finalStandings[0].wins != null, 'final standings carry W-L records');
  // non-master cannot complete
  const code2 = await ready(db, 'swiss', { swissRounds: 5, bestOf: 1, teamsheet: 'closed' }, 2);
  S.launch(db, code2, 'm');
  assert.throws(() => S.completeTournament(db, code2, 'p1'), /organizer/);
});

test('swiss → playoff: advance builds the bracket from standings', async () => {
  const db = await mkDb();
  const code = await ready(db, 'swiss_playoff',
    { swissRounds: 2, playoffSize: 4, swissBestOf: 1, playoffBestOf: 3, teamsheet: 'open', thirdPlace: false }, 4);
  S.launch(db, code, 'm');
  // play 2 swiss rounds
  for (let r = 1; r <= 2; r++) {
    for (const m of state(db, code).matches.filter(x => x.stage === 'swiss' && x.round === r)) {
      if (m.status !== 'bye') bothReport(db, code, m, 1, 0);
    }
    S.advance(db, code, 'm'); // r1→r2, then r2→playoff
  }
  const st = state(db, code);
  assert.equal(st.stage, 'playoff');
  const r0 = st.matches.filter(m => m.stage === 'playoff' && m.round === 0);
  assert.equal(r0.length, 2); // 4-player single elim → 2 semis
  assert.ok(r0.every(m => m.p1 && m.p2));
});
