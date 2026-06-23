// One-off: re-sync ONLY the 2026 Turin Pokémon Special Championships
// using the updated RK9 sync (picks up Stat Alignment). Leaves all other
// tournaments untouched.
//
//   node src/scripts/resyncTurin.js
//
const { getDb, initSchema, flushToDisk } = require('../db/schema');
const {
  scrapeRk9Tournaments,
  scrapeRk9Roster,
  scrapeRk9TeamList,
} = require('../services/rk9Sync');

const TOP_N = 64;
const delay = ms => new Promise(r => setTimeout(r, ms));

async function batchedMap(items, fn, concurrency = 3, pauseMs = 600) {
  const results = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    results.push(...await Promise.all(batch.map(fn)));
    if (i + concurrency < items.length) await delay(pauseMs);
  }
  return results;
}

(async () => {
  await initSchema();
  const db = await getDb();
  const now = new Date().toISOString();

  console.log('[resyncTurin] Scraping RK9 tournament list...');
  const tournaments = await scrapeRk9Tournaments();

  const turin = tournaments.find(t => /turin/i.test(t.name));
  if (!turin) {
    console.error('[resyncTurin] Could not find a Turin tournament in the RK9 list. Available:');
    tournaments.forEach(t => console.error(`  - ${t.name} (${t.id})`));
    process.exit(1);
  }

  console.log(`[resyncTurin] Target: ${turin.name} (${turin.id})`);

  const { players, top } = await scrapeRk9Roster(turin.id, TOP_N);
  if (top.length === 0) {
    console.error('[resyncTurin] No Masters roster found — aborting (DB unchanged).');
    process.exit(1);
  }

  console.log(`[resyncTurin] Roster: ${players} Masters, fetching top ${top.length} team lists...`);
  const withTeams = await batchedMap(top, async (player) => {
    const team = await scrapeRk9TeamList(turin.id, player.playerId);
    return { ...player, team };
  }, 3, 600);

  const standings = withTeams.map(p => ({
    placing: p.standing === 9999 ? null : p.standing,
    name:    p.name,
    country: p.country,
    record:  null,
    team:    p.team,
  }));

  const upsertTournament = db.prepare(`
    INSERT INTO tournaments (id, name, date, players, format, has_lists, source, synced_at)
    VALUES (:id, :name, :date, :players, :format, :has_lists, :source, :synced_at)
    ON CONFLICT(id) DO UPDATE SET
      name      = excluded.name,
      date      = excluded.date,
      players   = excluded.players,
      format    = excluded.format,
      has_lists = excluded.has_lists,
      source    = excluded.source,
      synced_at = excluded.synced_at
  `);
  const upsertStandings = db.prepare(`
    INSERT INTO tournament_standings (tournament_id, standings_json, synced_at)
    VALUES (:tournament_id, :standings_json, :synced_at)
    ON CONFLICT(tournament_id) DO UPDATE SET
      standings_json = excluded.standings_json,
      synced_at      = excluded.synced_at
  `);

  db.transaction(() => {
    upsertTournament.run({
      id:        turin.id,
      name:      turin.name,
      date:      turin.date,
      players,
      format:    turin.tier,
      has_lists: 1,
      source:    'rk9',
      synced_at: now,
    });
    upsertStandings.run({
      tournament_id:  turin.id,
      standings_json: JSON.stringify(standings),
      synced_at:      now,
    });
  })();

  flushToDisk();

  const withLists = standings.filter(s => s.team).length;
  const withAlign = standings.filter(s => s.team?.some(p => p.statAlignment)).length;
  console.log(`[resyncTurin] ✓ Done — ${players} players, ${withLists} team lists, ${withAlign} lists carry Stat Alignment.`);
  process.exit(0);
})().catch(err => {
  console.error('[resyncTurin] Failed:', err);
  process.exit(1);
});
