// services/tournamentSync.js
// Fetches VGC tournament data from Limitless TCG and caches it in the local DB.
// Daily delta sync: only fetches tournaments added since the last sync.

const { getDb, flushToDisk } = require('../db/schema');

const LIMITLESS_BASE = 'https://play.limitlesstcg.com/api';
const KV_KEY = 'limitless_last_sync';

const delay = ms => new Promise(r => setTimeout(r, ms));

// Champions Era regulations start with "M-" on Limitless (M-A, M-B, M-C, …).
// Future regulations are included automatically as long as they follow the same prefix.
function isChampionsEraFormat(format) {
  if (!format) return false;
  return format.toUpperCase().startsWith('M-');
}

// Fetch with retry on 429 — exponential back-off so rate limits clear
async function fetchWithRetry(url, retries = 5, baseDelay = 3000) {
  for (let attempt = 0; attempt < retries; attempt++) {
    const res = await fetch(url);
    if (res.ok) return res;
    if (res.status === 429) {
      const wait = baseDelay * Math.pow(2, attempt); // 3 → 6 → 12 → 24 → 48s
      console.warn(`[tournamentSync] 429 — waiting ${wait}ms`);
      await delay(wait);
      continue;
    }
    return res; // non-429 error — caller decides
  }
  throw new Error(`[tournamentSync] Failed after ${retries} retries: ${url}`);
}

// Run fn on each item, max `concurrency` at a time, with `pauseMs` between batches
async function batchedMap(items, fn, concurrency = 3, pauseMs = 500) {
  const results = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    results.push(...await Promise.all(batch.map(fn)));
    if (i + concurrency < items.length) await delay(pauseMs);
  }
  return results;
}

// ── KV helpers ────────────────────────────────────────────────────────────────
function getLastSync(db) {
  const row = db.prepare('SELECT value FROM kv_store WHERE key = :k').get({ k: KV_KEY });
  return row ? new Date(row.value) : new Date(0);
}

function setLastSync(db, date) {
  db.prepare(`
    INSERT INTO kv_store (key, value) VALUES (:k, :v)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run({ k: KV_KEY, v: date.toISOString() });
}

// ── Delta sync ────────────────────────────────────────────────────────────────
// Only processes tournaments newer than the last sync date.
// Also pre-fetches standings for every new tournament so clicks are always instant.
async function syncTournaments() {
  const db       = await getDb();
  const lastSync = getLastSync(db);
  const now      = new Date();

  console.log(`[tournamentSync] Delta sync — last sync: ${lastSync.toISOString()}`);

  // Fetch recent list from Limitless (newest-first, 100 is plenty for a daily delta)
  const listRes = await fetchWithRetry(`${LIMITLESS_BASE}/tournaments?game=VGC&limit=100`);
  if (!listRes.ok) throw new Error(`Limitless list error: ${listRes.status}`);
  const list = await listRes.json();

  // Stop early once we hit tournaments older than last sync
  // (list is newest-first so we can break as soon as we see old ones)
  const existingIds = new Set(
    db.prepare('SELECT id FROM tournaments WHERE source = :s').all({ s: 'limitless' }).map(r => r.id)
  );
  const candidates = list.filter(t => {
    if (existingIds.has(t.id)) return false;           // already in DB
    const d = t.date ? new Date(t.date) : null;
    return !d || d > lastSync;                         // newer than last sync
  });

  if (candidates.length === 0) {
    console.log('[tournamentSync] Nothing new since last sync');
    setLastSync(db, now);
    flushToDisk();
    return { synced: 0, at: now.toISOString() };
  }

  console.log(`[tournamentSync] ${candidates.length} new tournament(s) to process`);

  // Fetch details for candidates only
  const detailed = await batchedMap(candidates, async t => {
    try {
      const dr = await fetchWithRetry(`${LIMITLESS_BASE}/tournaments/${t.id}/details`);
      const d  = dr.ok ? await dr.json() : {};
      return {
        id: t.id, name: t.name, date: t.date ?? null,
        players: t.players ?? 0,
        format: t.format ?? d.format ?? null,
        hasLists: !!d.decklists,
      };
    } catch (err) {
      console.warn(`[tournamentSync] Details failed for ${t.id}: ${err.message}`);
      return { id: t.id, name: t.name, date: t.date ?? null, players: t.players ?? 0, format: t.format ?? null, hasLists: false };
    }
  }, 3, 500);

  const toStore = detailed.filter(t => t.hasLists && isChampionsEraFormat(t.format));
  console.log(`[tournamentSync] ${toStore.length} pass Champions Era + has_lists filter`);

  if (toStore.length === 0) {
    setLastSync(db, now);
    flushToDisk();
    return { synced: 0, at: now.toISOString() };
  }

  // Upsert tournaments
  const upsert = db.prepare(`
    INSERT INTO tournaments (id, name, date, players, format, has_lists, source, synced_at)
    VALUES (:id, :name, :date, :players, :format, :has_lists, :source, :synced_at)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name, date = excluded.date, players = excluded.players,
      format = excluded.format, has_lists = excluded.has_lists,
      source = excluded.source, synced_at = excluded.synced_at
  `);

  db.transaction(() => {
    for (const t of toStore) {
      upsert.run({
        id: t.id, name: t.name, date: t.date,
        players: t.players, format: t.format,
        has_lists: 1, source: 'limitless',
        synced_at: now.toISOString(),
      });
    }
  })();

  // Pre-fetch standings for every new tournament (so UI clicks are instant)
  const standingsUpsert = db.prepare(`
    INSERT INTO tournament_standings (tournament_id, standings_json, synced_at)
    VALUES (:tournament_id, :standings_json, :synced_at)
    ON CONFLICT(tournament_id) DO UPDATE SET
      standings_json = excluded.standings_json, synced_at = excluded.synced_at
  `);

  for (const t of toStore) {
    await delay(500);
    try {
      const raw = await fetchWithRetry(`${LIMITLESS_BASE}/tournaments/${t.id}/standings`);
      if (!raw.ok) { console.warn(`[tournamentSync] Standings fetch failed for ${t.id}`); continue; }
      const standings = await raw.json();
      const mapped = standings.map(p => ({
        placing: p.placing, name: p.name, country: p.country ?? null, record: p.record ?? null,
        team: Array.isArray(p.decklist)
          ? p.decklist.map(pk => ({
              name: pk.name, item: pk.item ?? '', ability: pk.ability ?? '',
              moves: Array.isArray(pk.attacks) ? pk.attacks.slice(0, 4) : [],
              teraType: pk.tera ?? null,
            }))
          : null,
      }));
      standingsUpsert.run({
        tournament_id: t.id,
        standings_json: JSON.stringify(mapped),
        synced_at: now.toISOString(),
      });
      console.log(`[tournamentSync] ✓ ${t.name} — standings cached`);
    } catch (err) {
      console.warn(`[tournamentSync] Standings error for ${t.id}: ${err.message}`);
    }
  }

  setLastSync(db, now);
  flushToDisk();
  console.log(`[tournamentSync] Done — ${toStore.length} tournament(s) synced`);
  return { synced: toStore.length, at: now.toISOString() };
}

// Kept for the standings-only route (first-click cache fill for older tournaments)
async function syncStandings(id) {
  const db = await getDb();
  const raw = await fetchWithRetry(`${LIMITLESS_BASE}/tournaments/${id}/standings`);
  if (!raw.ok) throw new Error(`Limitless standings error: ${raw.status} for ${id}`);
  const standings = await raw.json();
  const mapped = standings.map(p => ({
    placing: p.placing, name: p.name, country: p.country ?? null, record: p.record ?? null,
    team: Array.isArray(p.decklist)
      ? p.decklist.map(pk => ({
          name: pk.name, item: pk.item ?? '', ability: pk.ability ?? '',
          moves: Array.isArray(pk.attacks) ? pk.attacks.slice(0, 4) : [],
          teraType: pk.tera ?? null,
        }))
      : null,
  }));
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO tournament_standings (tournament_id, standings_json, synced_at)
    VALUES (:tournament_id, :standings_json, :synced_at)
    ON CONFLICT(tournament_id) DO UPDATE SET
      standings_json = excluded.standings_json, synced_at = excluded.synced_at
  `).run({ tournament_id: id, standings_json: JSON.stringify(mapped), synced_at: now });
  flushToDisk();
  return mapped;
}

module.exports = { syncTournaments, syncStandings };
