// tournament/engine.js
// PURE tournament logic — no DB, no network, no React. Everything here is a
// deterministic function of its inputs (except where an explicit rng is passed),
// so it is fully unit-testable in isolation. The service layer maps these
// abstract results onto persistent rows.
//
// Player identity is an opaque string id throughout. A "bye" opponent is null.

// ── Small helpers ─────────────────────────────────────────────────────────────
function isPowerOfTwo(n) {
  return Number.isInteger(n) && n >= 1 && (n & (n - 1)) === 0;
}

// Play! Pokémon norm: ceil(log2(N)) Swiss rounds for an N-player field.
function suggestSwissRounds(n) {
  if (n <= 1) return 0;
  return Math.ceil(Math.log2(n));
}

// Stable key for an unordered pair, used to detect rematches.
function pairKey(a, b) {
  return [a, b].sort().join('|');
}

// Fisher–Yates using an injectable rng (defaults to Math.random) for testability.
function shuffle(arr, rng = Math.random) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── Config validation ─────────────────────────────────────────────────────────
const FORMATS = ['round_robin', 'swiss', 'playoff', 'swiss_playoff'];

function validateConfig(format, config = {}, participantCount = 0) {
  const errors = [];
  if (!FORMATS.includes(format)) errors.push(`Unknown format "${format}"`);

  const needsSwiss   = format === 'swiss' || format === 'swiss_playoff';
  const needsPlayoff = format === 'playoff' || format === 'swiss_playoff';

  if (needsSwiss) {
    if (!Number.isInteger(config.swissRounds) || config.swissRounds < 1)
      errors.push('swissRounds must be an integer ≥ 1');
  }
  if (needsPlayoff) {
    if (!isPowerOfTwo(config.playoffSize) || config.playoffSize < 2)
      errors.push('playoffSize must be a power of two ≥ 2');
    else if (participantCount && config.playoffSize > participantCount)
      errors.push('playoffSize cannot exceed the number of participants');
  }
  if (format === 'playoff' && !['single', 'double'].includes(config.playoffType))
    errors.push("playoffType must be 'single' or 'double'");

  // Best-of(s)
  const validBO = v => v === 1 || v === 3;
  if (format === 'swiss_playoff') {
    if (!validBO(config.swissBestOf))   errors.push('swissBestOf must be 1 or 3');
    if (!validBO(config.playoffBestOf)) errors.push('playoffBestOf must be 1 or 3');
  } else if (!validBO(config.bestOf)) {
    errors.push('bestOf must be 1 or 3');
  }

  if (!['open', 'closed'].includes(config.teamsheet))
    errors.push("teamsheet must be 'open' or 'closed'");

  // Optional per-tournament no-show timer (minutes). Defaulted by the service if absent.
  if (config.noShowMinutes != null &&
      (!Number.isInteger(config.noShowMinutes) || config.noShowMinutes < 1))
    errors.push('noShowMinutes must be a positive integer');

  if (!config.name || !String(config.name).trim())
    errors.push('name is required');

  return { ok: errors.length === 0, errors };
}

// ── Round Robin (circle method) ────────────────────────────────────────────────
// Returns an array of rounds; each round is a list of [a, b] pairings (b === null
// means `a` has the bye that round). Every player meets every other exactly once.
function roundRobinSchedule(playerIds) {
  const players = [...playerIds];
  if (players.length < 2) return [];
  if (players.length % 2 === 1) players.push(null); // odd → bye marker

  const n = players.length;
  const half = n / 2;
  const arr = [...players];
  const rounds = [];

  for (let r = 0; r < n - 1; r++) {
    const pairings = [];
    for (let i = 0; i < half; i++) {
      const a = arr[i];
      const b = arr[n - 1 - i];
      if (a === null)      pairings.push([b, null]);
      else if (b === null) pairings.push([a, null]);
      else                 pairings.push([a, b]);
    }
    rounds.push(pairings);
    // rotate all but the first element clockwise
    arr.splice(1, 0, arr.pop());
  }
  return rounds;
}

// ── Swiss pairing (one round) ──────────────────────────────────────────────────
// orderedIds : active players sorted best→worst by current standings.
// history    : Set of pairKey() for matchups already played.
// byes       : Set of player ids who already had a bye.
// Greedy "fold" pairing within the standings order, avoiding rematches where it
// can; falls back to a rematch only if unavoidable. One bye to the lowest-ranked
// player without a prior bye.
function swissPairings(orderedIds, history = new Set(), byes = new Set()) {
  const pool = [...orderedIds];
  const pairings = [];

  if (pool.length % 2 === 1) {
    // bye → lowest-standing player who hasn't had one (else the very last)
    let idx = -1;
    for (let i = pool.length - 1; i >= 0; i--) {
      if (!byes.has(pool[i])) { idx = i; break; }
    }
    if (idx === -1) idx = pool.length - 1;
    const [byePlayer] = pool.splice(idx, 1);
    pairings.push([byePlayer, null]);
  }

  const used = new Set();
  for (let i = 0; i < pool.length; i++) {
    const a = pool[i];
    if (used.has(a)) continue;
    used.add(a);
    // first unused opponent we haven't already played
    let chosen = null;
    for (let j = i + 1; j < pool.length; j++) {
      const b = pool[j];
      if (used.has(b)) continue;
      if (!history.has(pairKey(a, b))) { chosen = b; break; }
    }
    // fallback: first unused opponent at all (forced rematch)
    if (chosen === null) {
      for (let j = i + 1; j < pool.length; j++) {
        if (!used.has(pool[j])) { chosen = pool[j]; break; }
      }
    }
    if (chosen !== null) { used.add(chosen); pairings.push([a, chosen]); }
  }
  return pairings;
}

// ── Standings + VGC tiebreakers ────────────────────────────────────────────────
// matches: [{ p1, p2, winner, p1Score, p2Score, isBye }]
//   p2 === null / isBye → p1 got a bye (counts as a win, opponent excluded).
//   winner = p1 | p2 | null (null = not yet decided; ignored here).
// Tiebreakers (Play! Pokémon): match points → opponents' win% → opp-opp win% →
// head-to-head → game differential. Each opponent win% is floored at 25% and is
// computed with the matches against the player in question excluded (spec-exact).
const RESISTANCE_FLOOR = 0.25;

function computeStandings(participantIds, matches) {
  const rec = new Map(); // id → { wins, losses, byes, gw, gl, opps:[] }
  for (const id of participantIds)
    rec.set(id, { wins: 0, losses: 0, byes: 0, gw: 0, gl: 0, opps: [] });

  // Directed head-to-head: h2h.get(`${a}|${b}`) = { matches, wins } from a's view.
  const h2h = new Map();
  const bump = (a, b, aWon) => {
    const k = `${a}|${b}`;
    const e = h2h.get(k) || { matches: 0, wins: 0 };
    e.matches++; if (aWon) e.wins++;
    h2h.set(k, e);
  };

  for (const m of matches) {
    if (m.winner == null && !m.isBye && m.p2 != null) continue; // undecided
    const r1 = rec.get(m.p1);
    if (!r1) continue;
    if (m.isBye || m.p2 == null) { r1.byes++; continue; }
    const r2 = rec.get(m.p2);
    if (!r2) continue;
    r1.opps.push(m.p2);
    r2.opps.push(m.p1);
    r1.gw += m.p1Score ?? 0; r1.gl += m.p2Score ?? 0;
    r2.gw += m.p2Score ?? 0; r2.gl += m.p1Score ?? 0;
    const p1Won = m.winner === m.p1;
    if (p1Won) { r1.wins++; r2.losses++; }
    else       { r2.wins++; r1.losses++; }
    bump(m.p1, m.p2, p1Won);
    bump(m.p2, m.p1, !p1Won);
  }

  const matchPoints = id => (rec.get(id).wins + rec.get(id).byes) * 3;
  const roundsPlayed = id => {
    const r = rec.get(id);
    return r.wins + r.losses + r.byes;
  };
  const winPct = id => {
    const rp = roundsPlayed(id);
    if (rp === 0) return 0;
    return (rec.get(id).wins + rec.get(id).byes) / rp;
  };
  // oppId's win% with the matches it played against `vsId` removed (spec-exact).
  const winPctExcluding = (oppId, vsId) => {
    const r = rec.get(oppId);
    const h = h2h.get(`${oppId}|${vsId}`) || { matches: 0, wins: 0 };
    const wins = r.wins + r.byes - h.wins;
    const rounds = roundsPlayed(oppId) - h.matches;
    if (rounds <= 0) return 0;
    return wins / rounds;
  };
  const owp = id => {
    const o = rec.get(id).opps;
    if (!o.length) return 0;
    return o.reduce((s, x) => s + Math.max(RESISTANCE_FLOOR, winPctExcluding(x, id)), 0) / o.length;
  };
  const oowp = id => {
    const o = rec.get(id).opps;
    if (!o.length) return 0;
    return o.reduce((s, x) => s + owp(x), 0) / o.length;
  };
  // Pairwise head-to-head: <0 if a outranks b, >0 if b outranks a, 0 if no
  // decisive result. Non-transitive across 3+ tied players by nature.
  const headToHead = (aId, bId) => {
    const ab = h2h.get(`${aId}|${bId}`);
    if (!ab) return 0;
    const ba = h2h.get(`${bId}|${aId}`) || { wins: 0 };
    return ba.wins - ab.wins;
  };

  const rows = participantIds.map(id => {
    const r = rec.get(id);
    return {
      clientId: id,
      wins: r.wins, losses: r.losses, byes: r.byes,
      matchPoints: matchPoints(id),
      gameWins: r.gw, gameLosses: r.gl,
      winPct: winPct(id),
      oppWinPct: owp(id),
      oppOppWinPct: oowp(id),
    };
  });

  rows.sort((a, b) =>
    b.matchPoints - a.matchPoints ||
    b.oppWinPct  - a.oppWinPct ||
    b.oppOppWinPct - a.oppOppWinPct ||
    headToHead(a.clientId, b.clientId) ||
    (b.gameWins - b.gameLosses) - (a.gameWins - a.gameLosses)
  );
  rows.forEach((row, i) => { row.rank = i + 1; });
  return rows;
}

// ── Match result resolution ────────────────────────────────────────────────────
// Given a best-of and a reported game score, decide validity + winner.
function resolveScore(bestOf, p1Score, p2Score) {
  const need = bestOf === 3 ? 2 : 1;
  const a = Number(p1Score), b = Number(p2Score);
  if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0)
    return { valid: false, reason: 'Scores must be non-negative integers' };
  if (a > need || b > need)
    return { valid: false, reason: `A player cannot win more than ${need} game(s)` };
  if (a === need && b === need)
    return { valid: false, reason: 'Both players cannot reach the win threshold' };
  if (a !== need && b !== need)
    return { valid: false, reason: 'Match is not complete' };
  return { valid: true, winner: a === need ? 'p1' : 'p2' };
}

// Do two independent reports agree?
function reportsAgree(r1, r2) {
  return r1 && r2 && r1.p1Score === r2.p1Score && r1.p2Score === r2.p2Score;
}

// ── Playoff seeding ────────────────────────────────────────────────────────────
// Standard single-elim seed order so the top seeds can only meet late.
// seedOrder(8) === [1,8,4,5,2,7,3,6]  (1-indexed seeds)
function seedOrder(size) {
  if (!isPowerOfTwo(size)) throw new Error('size must be a power of two');
  let seeds = [1, 2];
  while (seeds.length < size) {
    const sum = seeds.length * 2 + 1;
    const next = [];
    for (const s of seeds) { next.push(s); next.push(sum - s); }
    seeds = next;
  }
  return seeds;
}

// Build the Winners-bracket skeleton (shared by single & double elim).
// `seeds` = players ordered by seed (index 0 = seed 1). Returns a map of matches.
function buildWinnersBracket(seeds) {
  const size = seeds.length;
  const k = Math.log2(size);
  const order = seedOrder(size);
  const matches = {};
  const byRound = [];

  for (let r = 0; r < k; r++) {
    byRound[r] = [];
    const count = size / 2 ** (r + 1);
    for (let i = 0; i < count; i++) {
      const id = `W${r}-${i}`;
      const m = { id, bracket: 'W', round: r, index: i,
                  p1: null, p2: null, winnerTo: null, loserTo: null, isFinal: false };
      matches[id] = m;
      byRound[r].push(m);
    }
  }
  // seed round 0
  for (let i = 0; i < byRound[0].length; i++) {
    byRound[0][i].p1 = seeds[order[2 * i] - 1];
    byRound[0][i].p2 = seeds[order[2 * i + 1] - 1];
  }
  // winner feeds
  for (let r = 0; r < k - 1; r++) {
    for (let i = 0; i < byRound[r].length; i++) {
      const target = byRound[r + 1][Math.floor(i / 2)];
      byRound[r][i].winnerTo = { id: target.id, slot: i % 2 === 0 ? 1 : 2 };
    }
  }
  const finalId = byRound[k - 1][0].id;
  matches[finalId].isFinal = true;
  return { matches, byRound, k, finalId };
}

// Single elimination, optional 3rd-place match.
function buildSingleElimination(seeds, { thirdPlace = false } = {}) {
  const size = seeds.length;
  const { matches, byRound, k, finalId } = buildWinnersBracket(seeds);

  let thirdId = null;
  if (thirdPlace && size >= 4) {
    thirdId = 'TP';
    matches[thirdId] = { id: 'TP', bracket: 'TP', round: k - 1, index: 0,
                         p1: null, p2: null, winnerTo: null, loserTo: null, isFinal: false };
    const semis = byRound[k - 2];
    semis[0].loserTo = { id: 'TP', slot: 1 };
    semis[1].loserTo = { id: 'TP', slot: 2 };
  }
  return { type: 'single', matches: Object.values(matches), finalId, thirdId };
}

// Double elimination. Single grand final, NO bracket reset (per design A3).
function buildDoubleElimination(seeds) {
  const size = seeds.length;
  const { matches, k, finalId } = buildWinnersBracket(seeds);

  // Grand final
  matches['GF'] = { id: 'GF', bracket: 'GF', round: 0, index: 0,
                    p1: null, p2: null, winnerTo: null, loserTo: null, isFinal: true };
  matches[finalId].isFinal = false;
  matches[finalId].winnerTo = { id: 'GF', slot: 1 };

  if (k === 1) {
    // 2 players: WB final loser goes straight to the grand final.
    matches[finalId].loserTo = { id: 'GF', slot: 2 };
    return { type: 'double', matches: Object.values(matches), finalId: 'GF' };
  }

  // Losers bracket round counts: lr[1] = size/4; even j (major) keeps count,
  // odd j>1 (minor) halves it. Rounds run j = 1 .. 2k-2.
  const lastJ = 2 * k - 2;
  const lrCount = [];
  lrCount[1] = size / 4;
  for (let j = 2; j <= lastJ; j++) {
    lrCount[j] = (j % 2 === 0) ? lrCount[j - 1] : lrCount[j - 1] / 2;
  }
  // create LB matches
  for (let j = 1; j <= lastJ; j++) {
    for (let i = 0; i < lrCount[j]; i++) {
      const id = `L${j}-${i}`;
      matches[id] = { id, bracket: 'L', round: j, index: i,
                      p1: null, p2: null, winnerTo: null, loserTo: null, isFinal: false };
    }
  }
  // WR0 losers → L1 (two WR0 matches feed each L1 match)
  for (let i = 0; i < size / 2; i++) {
    matches[`W0-${i}`].loserTo = { id: `L1-${Math.floor(i / 2)}`, slot: i % 2 === 0 ? 1 : 2 };
  }
  // chain LB rounds
  for (let j = 2; j <= lastJ; j++) {
    if (j % 2 === 0) {
      // major: winner of L(j-1) match i + loser of WB round (j/2) match i
      const r = j / 2;
      for (let i = 0; i < lrCount[j]; i++) {
        matches[`L${j - 1}-${i}`].winnerTo = { id: `L${j}-${i}`, slot: 1 };
        matches[`W${r}-${i}`].loserTo      = { id: `L${j}-${i}`, slot: 2 };
      }
    } else {
      // minor: two L(j-1) winners fold into one L(j) match
      for (let i = 0; i < lrCount[j]; i++) {
        matches[`L${j - 1}-${2 * i}`].winnerTo     = { id: `L${j}-${i}`, slot: 1 };
        matches[`L${j - 1}-${2 * i + 1}`].winnerTo = { id: `L${j}-${i}`, slot: 2 };
      }
    }
  }
  // LB final winner → grand final slot 2
  matches[`L${lastJ}-0`].winnerTo = { id: 'GF', slot: 2 };

  return { type: 'double', matches: Object.values(matches), finalId: 'GF' };
}

// Place a resolved match's winner/loser into their downstream slots.
// `bracket` is a { id → match } map (mutated). Returns ids of matches now ready
// (both slots filled and still pending).
function advanceBracket(bracketMap, matchId, winnerId, loserId) {
  const m = bracketMap[matchId];
  if (!m) return [];
  const ready = [];
  const place = (ref, playerId) => {
    if (!ref || playerId == null) return;
    const t = bracketMap[ref.id];
    if (!t) return;
    if (ref.slot === 1) t.p1 = playerId; else t.p2 = playerId;
    if (t.p1 != null && t.p2 != null) ready.push(t.id);
  };
  place(m.winnerTo, winnerId);
  place(m.loserTo, loserId);
  return ready;
}

module.exports = {
  isPowerOfTwo, suggestSwissRounds, pairKey, shuffle,
  FORMATS, validateConfig,
  roundRobinSchedule, swissPairings,
  computeStandings, RESISTANCE_FLOOR,
  resolveScore, reportsAgree,
  seedOrder, buildWinnersBracket,
  buildSingleElimination, buildDoubleElimination, advanceBracket,
};
