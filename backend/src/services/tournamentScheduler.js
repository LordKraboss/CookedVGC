// services/tournamentScheduler.js
// Runs the tournament delta sync daily at 00:05 UTC.
// On startup, catches up if the last sync was more than 24 hours ago.

const cron = require('node-cron');
const { syncTournaments } = require('./tournamentSync');
const { syncRk9 }         = require('./rk9Sync');

let _running = false;

async function runSync(reason) {
  if (_running) {
    console.log(`[scheduler] Sync already in progress, skipping (${reason})`);
    return;
  }
  _running = true;
  console.log(`[scheduler] Starting tournament sync (${reason})`);
  try {
    const [limitless, rk9] = await Promise.allSettled([
      syncTournaments(),
      syncRk9(),
    ]);
    const lCount = limitless.status === 'fulfilled' ? limitless.value.synced : 0;
    const rCount = rk9.status       === 'fulfilled' ? rk9.value.synced       : 0;
    if (limitless.status === 'rejected') console.error(`[scheduler] Limitless sync failed: ${limitless.reason?.message}`);
    if (rk9.status       === 'rejected') console.error(`[scheduler] RK9 sync failed: ${rk9.reason?.message}`);
    console.log(`[scheduler] Sync complete — Limitless: ${lCount} new, RK9: ${rCount} new`);
  } catch (err) {
    console.error(`[scheduler] Sync failed: ${err.message}`);
  } finally {
    _running = false;
  }
}

async function startTournamentScheduler(db) {
  // ── Startup catch-up ────────────────────────────────────────────────────────
  // If the server was down at midnight, sync now if last sync > 24h ago
  const row = db.prepare("SELECT value FROM kv_store WHERE key = 'limitless_last_sync'").get({});
  const lastSync = row ? new Date(row.value) : new Date(0);
  const hoursSince = (Date.now() - lastSync.getTime()) / 3_600_000;

  if (hoursSince > 24) {
    console.log(`[scheduler] Last sync was ${Math.round(hoursSince)}h ago — catching up`);
    // Run after a short delay so the server finishes starting up first
    setTimeout(() => runSync('startup catch-up'), 5_000);
  } else {
    console.log(`[scheduler] Last sync ${Math.round(hoursSince)}h ago — up to date`);
  }

  // ── Daily cron at 00:05 UTC ─────────────────────────────────────────────────
  cron.schedule('5 0 * * *', () => runSync('daily cron'), { timezone: 'UTC' });
  console.log('[scheduler] Daily tournament sync scheduled at 00:05 UTC');
}

module.exports = { startTournamentScheduler };
