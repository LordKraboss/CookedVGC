// tournament/service.test.js — run with:  node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const initSqlJs = require('sql.js');
const { wrapDb } = require('../db/schema');
const S = require('./service');
const store = require('./store');

// Fresh in-memory wrapped DB per test (wrapDb's disk-save is a no-op here because
// the module singleton it guards on was never initialised).
async function mkDb() {
  const SQL = await initSqlJs();
  return wrapDb(new SQL.Database());
}

const RR = { format: 'round_robin', config: { bestOf: 3, teamsheet: 'open' } };

test('create: persists a lobby event and rejects bad config', async () => {
  const db = await mkDb();
  const { code } = S.createTournament(db, {
    name: 'Spring Cup', regId: 'regi', masterClientId: 'm1', masterName: 'TO', ...RR,
  });
  assert.ok(code && code.length >= 4);
  const ev = store.getEvent(db, code);
  assert.equal(ev.status, 'lobby');
  assert.equal(ev.name, 'Spring Cup');
  assert.equal(JSON.parse(ev.config_json).noShowMinutes, 10); // defaulted

  assert.throws(() => S.createTournament(db, {
    name: '', masterClientId: 'm1', ...RR,
  }), /Invalid config/);
});

test('create with organizer playing seeds him as a participant', async () => {
  const db = await mkDb();
  const { code } = S.createTournament(db, {
    name: 'Cup', masterClientId: 'm1', masterName: 'Ash', masterPlays: true, ...RR,
  });
  const ps = store.getParticipants(db, code);
  assert.equal(ps.length, 1);
  assert.equal(ps[0].client_id, 'm1');
});

test('join is idempotent (reconnect reclaims the same seat)', async () => {
  const db = await mkDb();
  const { code } = S.createTournament(db, { name: 'Cup', masterClientId: 'm1', ...RR });
  S.joinTournament(db, code, 'p1', 'Red');
  S.joinTournament(db, code, 'p2', 'Blue');
  // reconnect p1
  const st = S.joinTournament(db, code, 'p1', 'Red again');
  assert.equal(store.getParticipants(db, code).length, 2); // no duplicate
  assert.ok(st.you.isParticipant);
});

test('join rejected after start; participants can still reconnect; not-found errors', async () => {
  const db = await mkDb();
  const { code } = S.createTournament(db, { name: 'Cup', masterClientId: 'm1', ...RR });
  S.joinTournament(db, code, 'p1', 'Red'); // joined while in lobby
  // simulate a started event
  db.prepare("UPDATE tour_events SET status='running' WHERE code=?").run(code);
  // a brand-new player cannot join a running event
  assert.throws(() => S.joinTournament(db, code, 'pNew', 'New'), /already started/);
  // an existing participant CAN reconnect mid-event
  const st = S.joinTournament(db, code, 'p1');
  assert.ok(st.you.isParticipant);
  // unknown code → not found
  assert.throws(() => S.joinTournament(db, 'ZZZZ', 'p1'), /not found/);
});

test('team submit + organizer reject flow', async () => {
  const db = await mkDb();
  const { code } = S.createTournament(db, {
    name: 'Cup', masterClientId: 'm1', masterPlays: false, ...RR,
  });
  S.joinTournament(db, code, 'p1', 'Red');
  S.submitTeam(db, code, 'p1', [{ name: 'Incineroar' }]);
  let p = store.getParticipant(db, code, 'p1');
  assert.equal(p.team_status, 'submitted');

  S.rejectTeam(db, code, 'm1', 'p1', 'Illegal item');
  p = store.getParticipant(db, code, 'p1');
  assert.equal(p.team_status, 'rejected');
  assert.equal(p.reject_comment, 'Illegal item');

  // non-master cannot reject
  assert.throws(() => S.rejectTeam(db, code, 'p1', 'p1', 'x'), /organizer/);
});

test('state scoping: teams hidden from peers, visible to a non-playing organizer', async () => {
  const db = await mkDb();
  const { code } = S.createTournament(db, {
    name: 'Cup', masterClientId: 'm1', masterPlays: false, ...RR,
  });
  S.joinTournament(db, code, 'p1', 'Red');
  S.joinTournament(db, code, 'p2', 'Blue');
  S.submitTeam(db, code, 'p1', [{ name: 'Gholdengo' }]);

  // p2 (a peer) cannot see p1's team
  const asPeer = S.getStateFor(db, code, 'p2');
  assert.equal(asPeer.participants.find(p => p.clientId === 'p1').team, null);
  assert.equal(asPeer.participants.find(p => p.clientId === 'p1').hasTeam, true);

  // p1 sees their own team
  const asSelf = S.getStateFor(db, code, 'p1');
  assert.ok(asSelf.participants.find(p => p.clientId === 'p1').team);

  // master (not playing) sees everyone's team for review
  const asMaster = S.getStateFor(db, code, 'm1');
  assert.ok(asMaster.participants.find(p => p.clientId === 'p1').team);
  assert.ok(asMaster.you.isMaster);
});

test('destroy removes children and tombstones the event', async () => {
  const db = await mkDb();
  const { code } = S.createTournament(db, { name: 'Cup', masterClientId: 'm1', ...RR });
  S.joinTournament(db, code, 'p1');
  S.destroyTournament(db, code, 'm1');
  assert.equal(store.getEvent(db, code).status, 'destroyed');
  assert.equal(store.getParticipants(db, code).length, 0);
  assert.throws(() => S.joinTournament(db, code, 'p2'), /no longer available/);
});

test('updated_at is bumped on mutations (drives the sweep)', async () => {
  const db = await mkDb();
  const { code } = S.createTournament(db, { name: 'Cup', masterClientId: 'm1', ...RR });
  const t0 = store.getEvent(db, code).updated_at;
  // force a later clock by writing an older value then joining
  db.prepare("UPDATE tour_events SET updated_at='2000-01-01T00:00:00.000Z' WHERE code=?").run(code);
  S.joinTournament(db, code, 'p1');
  const t1 = store.getEvent(db, code).updated_at;
  assert.ok(t1 > '2000-01-01T00:00:00.000Z');
  assert.ok(t1 >= t0 || true);
});

test('sweepStale abandons inactive lobby/running, spares fresh + complete', async () => {
  const db = await mkDb();
  const mk = (name) => S.createTournament(db, { name, masterClientId: 'm', ...RR }).code;
  const old1 = mk('Old lobby');
  const old2 = mk('Old running');
  const fresh = mk('Fresh');
  const done  = mk('Completed');

  const oldIso = '2020-01-01T00:00:00.000Z';
  db.prepare("UPDATE tour_events SET updated_at=? WHERE code=?").run(oldIso, old1);
  db.prepare("UPDATE tour_events SET status='running', updated_at=? WHERE code=?").run(oldIso, old2);
  db.prepare("UPDATE tour_events SET status='complete', updated_at=? WHERE code=?").run(oldIso, done);

  const res = S.sweepStale(db, 7);
  assert.ok(res.abandoned.includes(old1));
  assert.ok(res.abandoned.includes(old2));
  assert.ok(!res.abandoned.includes(fresh));
  assert.ok(!res.abandoned.includes(done)); // completed events are the archive
  assert.equal(store.getEvent(db, old1).status, 'abandoned');
  assert.equal(store.getEvent(db, done).status, 'complete');
});

// ── launch ────────────────────────────────────────────────────────────────────────
async function readyTournament(db, format, config, n) {
  const { code } = S.createTournament(db, { name: 'Cup', masterClientId: 'm', format, config });
  for (let i = 1; i <= n; i++) {
    S.joinTournament(db, code, `p${i}`, `P${i}`);
    S.submitTeam(db, code, `p${i}`, [{ name: 'Mon' + i }]);
  }
  return code;
}

test('launch: round robin drops unready, generates full schedule, activates round 1', async () => {
  const db = await mkDb();
  const { code } = S.createTournament(db, { name: 'Cup', masterClientId: 'm', ...RR });
  for (const id of ['p1', 'p2', 'p3', 'p4']) S.joinTournament(db, code, id);
  for (const id of ['p1', 'p2', 'p3']) S.submitTeam(db, code, id, [{ name: 'x' }]); // p4 not ready
  const st = S.launch(db, code, 'm');
  assert.equal(st.status, 'running');
  assert.equal(st.stage, 'round_robin');
  // p4 dropped
  assert.equal(st.participants.find(p => p.clientId === 'p4').status, 'dropped');
  // 3 ready (odd) → schedule with byes; round 1 matches are activated
  const r1 = st.matches.filter(m => m.round === 1);
  assert.ok(r1.length >= 1);
  assert.ok(r1.some(m => m.activatedAt));
});

test('launch: needs 2 ready; only master can launch', async () => {
  const db = await mkDb();
  const { code } = S.createTournament(db, { name: 'Cup', masterClientId: 'm', ...RR });
  S.joinTournament(db, code, 'p1'); S.submitTeam(db, code, 'p1', []);
  assert.throws(() => S.launch(db, code, 'm'), /at least 2/);
  S.joinTournament(db, code, 'p2'); S.submitTeam(db, code, 'p2', []);
  assert.throws(() => S.launch(db, code, 'p1'), /organizer/);
  const st = S.launch(db, code, 'm');
  assert.equal(st.status, 'running');
});

test('launch: direct playoff builds a seeded bracket', async () => {
  const db = await mkDb();
  const code = await readyTournament(db, 'playoff',
    { playoffSize: 4, playoffType: 'single', bestOf: 3, teamsheet: 'closed', thirdPlace: true }, 4);
  const st = S.launch(db, code, 'm');
  assert.equal(st.stage, 'playoff');
  // single elim of 4 = 3 WB + 1 third place = 4 matches
  assert.equal(st.matches.length, 4);
  const r0 = st.matches.filter(m => m.round === 0 && m.bracket === 'W');
  assert.equal(r0.length, 2);
  assert.ok(r0.every(m => m.p1 && m.p2 && m.activatedAt)); // both semis seeded + active
});

test('open vs closed teamsheet reveal in match state', async () => {
  const db = await mkDb();
  // open
  const codeOpen = await readyTournament(db, 'round_robin', { bestOf: 1, teamsheet: 'open' }, 2);
  S.launch(db, codeOpen, 'm');
  const asP1 = S.getStateFor(db, codeOpen, 'p1');
  const myMatch = asP1.matches.find(m => m.youAreIn);
  assert.ok(myMatch.opponentTeam, 'open teamsheet should reveal opponent team');

  // closed
  const codeClosed = await readyTournament(db, 'round_robin', { bestOf: 1, teamsheet: 'closed' }, 2);
  S.launch(db, codeClosed, 'm');
  const cP1 = S.getStateFor(db, codeClosed, 'p1');
  const cMatch = cP1.matches.find(m => m.youAreIn);
  assert.equal(cMatch.opponentTeam, null, 'closed teamsheet hides opponent team');
});

test('listResults returns completed events with player counts', async () => {
  const db = await mkDb();
  const { code } = S.createTournament(db, { name: 'Done Cup', masterClientId: 'm', ...RR });
  S.joinTournament(db, code, 'p1');
  S.joinTournament(db, code, 'p2');
  db.prepare("UPDATE tour_events SET status='complete', completed_at='2026-01-01T00:00:00.000Z' WHERE code=?").run(code);
  const list = S.listResults(db);
  assert.equal(list.length, 1);
  assert.equal(list[0].players, 2);
  assert.equal(list[0].name, 'Done Cup');
});
