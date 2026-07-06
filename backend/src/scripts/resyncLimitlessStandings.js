// Re-fetches cached Limitless standings so they pick up fields added to the
// mapping since they were first cached (e.g. Stat Alignment / nature).
// Leaves tournaments themselves untouched — only overwrites tournament_standings.
//
//   node src/scripts/resyncLimitlessStandings.js --limit 5
//   node src/scripts/resyncLimitlessStandings.js --days 14
//
const { getDb, initSchema } = require('../db/schema');
const { syncStandings } = require('../services/tournamentSync');

const delay = ms => new Promise(r => setTimeout(r, ms));

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag) => {
    const i = args.indexOf(flag);
    return i === -1 ? null : args[i + 1];
  };
  const limit = get('--limit');
  const days = get('--days');
  return { limit: limit ? parseInt(limit, 10) : null, days: days ? parseInt(days, 10) : null };
}

(async () => {
  const { limit, days } = parseArgs();
  if (!limit && !days) {
    console.error('Usage: node src/scripts/resyncLimitlessStandings.js --limit N | --days N');
    process.exit(1);
  }

  await initSchema();
  const db = await getDb();

  const rows = days
    ? db.prepare(`
        SELECT id, name, date FROM tournaments
        WHERE source = 'limitless' AND has_lists = 1 AND date >= :since
        ORDER BY date DESC
      `).all({ since: new Date(Date.now() - days * 86400_000).toISOString() })
    : db.prepare(`
        SELECT id, name, date FROM tournaments
        WHERE source = 'limitless' AND has_lists = 1
        ORDER BY date DESC
        LIMIT :limit
      `).all({ limit });

  if (rows.length === 0) {
    console.log('[resyncLimitless] No matching tournaments found.');
    process.exit(0);
  }

  console.log(`[resyncLimitless] Re-syncing standings for ${rows.length} tournament(s)...`);

  let ok = 0, failed = 0, withAlign = 0;
  for (const t of rows) {
    try {
      const standings = await syncStandings(t.id);
      const hasAlign = standings.some(p => p.team?.some(pk => pk.statAlignment));
      if (hasAlign) withAlign++;
      ok++;
      console.log(`  ✓ ${t.name} (${(t.date || '').slice(0, 10)})${hasAlign ? ' — has Stat Alignment' : ''}`);
    } catch (err) {
      failed++;
      console.warn(`  ✗ ${t.name}: ${err.message}`);
    }
    await delay(600);
  }

  console.log(`[resyncLimitless] Done — ${ok} synced, ${failed} failed, ${withAlign} carry Stat Alignment.`);
  process.exit(0);
})().catch(err => {
  console.error('[resyncLimitless] Failed:', err);
  process.exit(1);
});
