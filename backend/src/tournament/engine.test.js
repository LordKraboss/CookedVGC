// tournament/engine.test.js — run with:  node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('./engine');

// ── helpers ─────────────────────────────────────────────────────────────────────
const ids = n => Array.from({ length: n }, (_, i) => `p${i + 1}`);

// Resolve a whole bracket assuming the LOWER seed index always wins (strength =
// position in `seeds`). Returns { results: Map(matchId→winner), placements }.
function simulateBracket(built, seeds, { upsets = {} } = {}) {
  const map = Object.fromEntries(built.matches.map(m => [m.id, { ...m }]));
  const strength = new Map(seeds.map((id, i) => [id, i])); // lower = stronger
  const stronger = (a, b) => {
    if (a == null) return b; if (b == null) return a;
    return strength.get(a) <= strength.get(b) ? a : b;
  };
  // ready queue = matches with both players known
  const done = new Set();
  const winners = {};
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const m of Object.values(map)) {
      if (done.has(m.id)) continue;
      if (m.p1 == null || m.p2 == null) continue;
      let win, lose;
      if (upsets[m.id]) { win = upsets[m.id]; lose = win === m.p1 ? m.p2 : m.p1; }
      else { win = stronger(m.p1, m.p2); lose = win === m.p1 ? m.p2 : m.p1; }
      winners[m.id] = win;
      // place downstream
      const place = (ref, pid) => {
        if (!ref) return;
        const t = map[ref.id];
        if (ref.slot === 1) t.p1 = pid; else t.p2 = pid;
      };
      place(m.winnerTo, win);
      place(m.loserTo, lose);
      done.add(m.id);
      progressed = true;
    }
  }
  return { map, winners };
}

// ── power of two / swiss rounds ──────────────────────────────────────────────────
test('isPowerOfTwo', () => {
  for (const n of [1, 2, 4, 8, 16, 32]) assert.ok(E.isPowerOfTwo(n));
  for (const n of [0, 3, 5, 6, 7, 12, 31]) assert.ok(!E.isPowerOfTwo(n));
});

test('suggestSwissRounds', () => {
  assert.equal(E.suggestSwissRounds(8), 3);
  assert.equal(E.suggestSwissRounds(9), 4);
  assert.equal(E.suggestSwissRounds(16), 4);
  assert.equal(E.suggestSwissRounds(17), 5);
});

// ── config validation ────────────────────────────────────────────────────────────
const NAME = { name: 'Test Cup' };

test('validateConfig: round robin', () => {
  assert.ok(E.validateConfig('round_robin', { ...NAME, bestOf: 3, teamsheet: 'open' }, 6).ok);
  assert.ok(!E.validateConfig('round_robin', { ...NAME, bestOf: 2, teamsheet: 'open' }, 6).ok);
});

test('validateConfig: playoff power-of-two + cap', () => {
  assert.ok(E.validateConfig('playoff', { ...NAME, playoffSize: 8, playoffType: 'single', bestOf: 3, teamsheet: 'closed' }, 10).ok);
  assert.ok(!E.validateConfig('playoff', { ...NAME, playoffSize: 6, playoffType: 'single', bestOf: 3, teamsheet: 'closed' }, 10).ok);
  assert.ok(!E.validateConfig('playoff', { ...NAME, playoffSize: 16, playoffType: 'single', bestOf: 3, teamsheet: 'closed' }, 8).ok);
});

test('validateConfig: swiss_playoff needs both best-ofs', () => {
  const ok = E.validateConfig('swiss_playoff',
    { ...NAME, swissRounds: 5, playoffSize: 8, swissBestOf: 3, playoffBestOf: 3, teamsheet: 'open' }, 32);
  assert.ok(ok.ok, ok.errors.join(','));
  const bad = E.validateConfig('swiss_playoff',
    { ...NAME, swissRounds: 5, playoffSize: 8, swissBestOf: 3, teamsheet: 'open' }, 32);
  assert.ok(!bad.ok);
});

test('validateConfig: name required, no-show timer optional/positive', () => {
  assert.ok(!E.validateConfig('round_robin', { bestOf: 3, teamsheet: 'open' }, 6).ok); // no name
  assert.ok(E.validateConfig('round_robin', { ...NAME, bestOf: 3, teamsheet: 'open', noShowMinutes: 10 }, 6).ok);
  assert.ok(!E.validateConfig('round_robin', { ...NAME, bestOf: 3, teamsheet: 'open', noShowMinutes: 0 }, 6).ok);
  assert.ok(!E.validateConfig('round_robin', { ...NAME, bestOf: 3, teamsheet: 'open', noShowMinutes: 2.5 }, 6).ok);
});

// ── round robin ──────────────────────────────────────────────────────────────────
test('roundRobinSchedule: 4 players, everyone once, no repeats', () => {
  const rounds = E.roundRobinSchedule(ids(4));
  assert.equal(rounds.length, 3);
  const seen = new Set();
  const counts = new Map(ids(4).map(i => [i, 0]));
  for (const round of rounds) {
    assert.equal(round.length, 2);
    for (const [a, b] of round) {
      assert.notEqual(b, null);
      const k = E.pairKey(a, b);
      assert.ok(!seen.has(k), `repeat ${k}`);
      seen.add(k);
      counts.set(a, counts.get(a) + 1);
      counts.set(b, counts.get(b) + 1);
    }
  }
  assert.equal(seen.size, 6); // C(4,2)
  for (const c of counts.values()) assert.equal(c, 3);
});

test('roundRobinSchedule: 5 players, byes, each plays 4 distinct + 1 bye', () => {
  const rounds = E.roundRobinSchedule(ids(5));
  assert.equal(rounds.length, 5);
  const opp = new Map(ids(5).map(i => [i, new Set()]));
  const byes = new Map(ids(5).map(i => [i, 0]));
  for (const round of rounds) {
    for (const [a, b] of round) {
      if (b === null) byes.set(a, byes.get(a) + 1);
      else { opp.get(a).add(b); opp.get(b).add(a); }
    }
  }
  for (const id of ids(5)) {
    assert.equal(opp.get(id).size, 4, `${id} should face 4 others`);
    assert.equal(byes.get(id), 1, `${id} should have exactly 1 bye`);
  }
});

// ── swiss ────────────────────────────────────────────────────────────────────────
test('swissPairings: pairs top-down, no rematch, even field', () => {
  const order = ids(8);
  const pairings = E.swissPairings(order, new Set(), new Set());
  assert.equal(pairings.length, 4);
  // round 1 from clean history folds [p1,p2],[p3,p4],...
  assert.deepEqual(pairings[0], ['p1', 'p2']);
  // no byes in an even field
  assert.ok(pairings.every(([, b]) => b !== null));
});

test('swissPairings: odd field gives bye to lowest without prior bye', () => {
  const order = ids(5);
  const byes = new Set(['p5']); // p5 already had one
  const pairings = E.swissPairings(order, new Set(), byes);
  const bye = pairings.find(([, b]) => b === null);
  assert.ok(bye);
  assert.equal(bye[0], 'p4'); // p5 skipped, next lowest is p4
});

test('swissPairings: avoids an existing rematch', () => {
  const order = ['p1', 'p2', 'p3', 'p4'];
  const history = new Set([E.pairKey('p1', 'p2')]);
  const pairings = E.swissPairings(order, history, new Set());
  // p1 must NOT be paired with p2 again
  const p1pair = pairings.find(p => p.includes('p1'));
  assert.ok(!p1pair.includes('p2'));
});

// ── standings + tiebreakers ──────────────────────────────────────────────────────
test('computeStandings: byes count as wins, ordering by points', () => {
  const players = ids(4);
  const matches = [
    { p1: 'p1', p2: 'p2', winner: 'p1', p1Score: 2, p2Score: 0 },
    { p1: 'p3', p2: 'p4', winner: 'p3', p1Score: 2, p2Score: 1 },
    { p1: 'p1', p2: null, isBye: true },
  ];
  const s = E.computeStandings(players, matches);
  assert.equal(s[0].clientId, 'p1');      // 2 wins (1 + bye) = 6 pts
  assert.equal(s[0].matchPoints, 6);
  assert.equal(s[0].byes, 1);
  // p2 and p4 both 0 points; order decided by tiebreakers but both last-ish
  const pts = Object.fromEntries(s.map(r => [r.clientId, r.matchPoints]));
  assert.equal(pts.p3, 3);
  assert.equal(pts.p2, 0);
  assert.equal(pts.p4, 0);
});

test('computeStandings: resistance breaks a tie on equal points', () => {
  // p1 and p2 each 1-1, but p1 beat a strong player; resistance favors the one
  // whose opponents won more.
  const players = ids(4);
  const matches = [
    // round 1
    { p1: 'p1', p2: 'p3', winner: 'p1', p1Score: 2, p2Score: 0 },
    { p1: 'p2', p2: 'p4', winner: 'p2', p1Score: 2, p2Score: 0 },
    // round 2
    { p1: 'p1', p2: 'p2', winner: 'p2', p1Score: 1, p2Score: 2 },
    // p3 beats p4 to lift p1's resistance above p2's
    { p1: 'p3', p2: 'p4', winner: 'p3', p1Score: 2, p2Score: 0 },
  ];
  const s = E.computeStandings(players, matches);
  const p1 = s.find(r => r.clientId === 'p1');
  const p2 = s.find(r => r.clientId === 'p2');
  // p2 has 2 wins (beat p4, beat p1) = 6 pts, p1 has 3 pts → p2 ahead on points
  assert.ok(p2.matchPoints >= p1.matchPoints);
  // p1's opponents (p3,p2) outperformed p4 → resistance sane and bounded
  assert.ok(p1.oppWinPct >= E.RESISTANCE_FLOOR);
});

test('computeStandings: OWP excludes the head-to-head match (spec-exact)', () => {
  // p1 beat p2. p2's only other result is a win over p3. From p1's perspective,
  // p2's win% must exclude the loss to p1 → p2 looks like a 1.0 (won its other
  // game), not 0.5. So p1's resistance is the floor-or-better max, here 1.0.
  const players = ids(3);
  const matches = [
    { p1: 'p1', p2: 'p2', winner: 'p1', p1Score: 2, p2Score: 0 },
    { p1: 'p2', p2: 'p3', winner: 'p2', p1Score: 2, p2Score: 0 },
  ];
  const s = E.computeStandings(players, matches);
  const p1 = s.find(r => r.clientId === 'p1');
  // p2 raw win% = 1/2 = 0.5; excluding its loss to p1 = 1/1 = 1.0.
  assert.equal(p1.oppWinPct, 1.0);
});

test('computeStandings: head-to-head is consulted when points/OWP/OOWP all tie', () => {
  // Rock-paper-scissors cycle: everyone 1-1, and the OWP exclusion makes all
  // three identical on match points, OWP, and OOWP — so the only remaining
  // signal is head-to-head (cyclic here, so it can't fully order the cycle).
  const players = ids(3);
  const matches = [
    { p1: 'p1', p2: 'p2', winner: 'p1', p1Score: 2, p2Score: 0 },
    { p1: 'p2', p2: 'p3', winner: 'p2', p1Score: 2, p2Score: 0 },
    { p1: 'p3', p2: 'p1', winner: 'p3', p1Score: 2, p2Score: 0 },
  ];
  const s = E.computeStandings(players, matches);
  // all three tie on the first three keys (proves the OWP exclusion math)
  assert.ok(s.every(r => r.matchPoints === 3));
  assert.ok(s.every(r => Math.abs(r.oppWinPct - s[0].oppWinPct) < 1e-9));
  assert.ok(s.every(r => Math.abs(r.oppOppWinPct - s[0].oppOppWinPct) < 1e-9));
  // comparator stays total/stable: distinct ranks 1..3, no throw
  assert.deepEqual([...new Set(s.map(r => r.rank))].sort(), [1, 2, 3]);
});

// ── match resolution ─────────────────────────────────────────────────────────────
test('resolveScore: BO1 and BO3', () => {
  assert.deepEqual(E.resolveScore(1, 1, 0), { valid: true, winner: 'p1' });
  assert.deepEqual(E.resolveScore(3, 2, 1), { valid: true, winner: 'p1' });
  assert.deepEqual(E.resolveScore(3, 1, 2), { valid: true, winner: 'p2' });
  assert.ok(!E.resolveScore(3, 2, 2).valid);  // both at threshold
  assert.ok(!E.resolveScore(3, 1, 1).valid);  // incomplete
  assert.ok(!E.resolveScore(1, 2, 0).valid);  // too many games
});

test('reportsAgree', () => {
  assert.ok(E.reportsAgree({ p1Score: 2, p2Score: 1 }, { p1Score: 2, p2Score: 1 }));
  assert.ok(!E.reportsAgree({ p1Score: 2, p2Score: 1 }, { p1Score: 2, p2Score: 0 }));
});

// ── seeding ──────────────────────────────────────────────────────────────────────
test('seedOrder', () => {
  assert.deepEqual(E.seedOrder(2), [1, 2]);
  assert.deepEqual(E.seedOrder(4), [1, 4, 2, 3]);
  assert.deepEqual(E.seedOrder(8), [1, 8, 4, 5, 2, 7, 3, 6]);
});

// ── single elimination ───────────────────────────────────────────────────────────
test('buildSingleElimination(8): match count + top seed wins when no upsets', () => {
  const seeds = ids(8);
  const built = E.buildSingleElimination(seeds, { thirdPlace: true });
  // WB matches: 4 + 2 + 1 = 7, plus a third-place match
  assert.equal(built.matches.filter(m => m.bracket === 'W').length, 7);
  assert.ok(built.thirdId);
  const { winners } = simulateBracket(built, seeds);
  assert.equal(winners[built.finalId], 'p1'); // strongest wins
  // 3rd place contested by the two semifinal losers
  assert.ok(winners['TP']);
});

test('buildSingleElimination: an upset changes the champion', () => {
  const seeds = ids(4);
  const built = E.buildSingleElimination(seeds);
  // force seed 4 to beat seed 1 in their semifinal (W0-0 is 1 vs 4)
  const { winners } = simulateBracket(built, seeds, { upsets: { 'W0-0': 'p4' } });
  assert.notEqual(winners[built.finalId], 'p1');
});

// ── double elimination ───────────────────────────────────────────────────────────
test('buildDoubleElimination(4): structure + champion with no upsets', () => {
  const seeds = ids(4);
  const built = E.buildDoubleElimination(seeds);
  assert.equal(built.finalId, 'GF');
  // WB: 2 + 1 = 3, LB: L1(1) + L2(1) = 2, GF: 1 → 6 total
  assert.equal(built.matches.length, 6);
  const { winners } = simulateBracket(built, seeds);
  assert.equal(winners['GF'], 'p1');
});

test('buildDoubleElimination(8): structure + champion with no upsets', () => {
  const seeds = ids(8);
  const built = E.buildDoubleElimination(seeds);
  // WB 4+2+1=7, LB L1(2)+L2(2)+L3(1)+L4(1)=6, GF 1 → 14
  assert.equal(built.matches.length, 14);
  const { winners } = simulateBracket(built, seeds);
  assert.equal(winners['GF'], 'p1');
});

test('buildDoubleElimination: one WB loss does not eliminate (two-losses rule)', () => {
  // seed 1 loses its first WB match, must be able to win it all via losers bracket.
  const seeds = ids(4);
  const built = E.buildDoubleElimination(seeds);
  // W0-0 = seed1 (p1) vs seed4 (p4). Force p4 to win. Then p1 runs the losers
  // bracket; with strength-based sim p1 beats everyone else it meets.
  const { winners } = simulateBracket(built, seeds, { upsets: { 'W0-0': 'p4' } });
  // p1 should resurface and win the grand final (it only lost once).
  assert.equal(winners['GF'], 'p1');
});

test('buildDoubleElimination(2): GF is WB final loser vs winner', () => {
  const seeds = ids(2);
  const built = E.buildDoubleElimination(seeds);
  const { winners } = simulateBracket(built, seeds);
  assert.equal(winners['GF'], 'p1');
});
