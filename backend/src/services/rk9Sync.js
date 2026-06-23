// services/rk9Sync.js
// Scrapes VGC tournament data from RK9.gg and caches it in the local DB.
// RK9 hosts official Pokemon events (Regionals, Internationals, Worlds).
// No public API — uses HTML scraping with cheerio.
// Rate-limited to avoid overloading their servers.

const cheerio = require('cheerio');
const { getDb, flushToDisk } = require('../db/schema');

const RK9_BASE = 'https://rk9.gg';

// Only pull the Champions tournament (May 29-31 2026) and any future events.
// Adjust this date forward as needed when new eras begin.
const CHAMPIONS_ERA_START = new Date('2026-05-28').getTime();

const delay = ms => new Promise(r => setTimeout(r, ms));

async function fetchHtml(url, retries = 3, baseDelay = 1500) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; VGCtool/1.0)' },
      });
      if (res.ok) return await res.text();
      if (res.status === 429) {
        const wait = baseDelay * Math.pow(2, attempt);
        console.warn(`[rk9Sync] 429 on ${url} — waiting ${wait}ms`);
        await delay(wait);
        continue;
      }
      console.warn(`[rk9Sync] HTTP ${res.status} on ${url}`);
      return null;
    } catch (err) {
      console.warn(`[rk9Sync] Fetch error on ${url}: ${err.message}`);
      if (attempt < retries - 1) await delay(baseDelay);
    }
  }
  return null;
}

// Run fn on each item, max `concurrency` at a time, with pauseMs between batches
async function batchedMap(items, fn, concurrency = 3, pauseMs = 600) {
  const results = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
    if (i + concurrency < items.length) await delay(pauseMs);
  }
  return results;
}

// Parse "May 8-10, 2026" or "April 3-5, 2026" → ISO date string of start day
function parseRk9Date(str) {
  if (!str) return null;
  const m = str.trim().match(/(\w+)\s+(\d+)(?:-\d+)?,\s+(\d{4})/);
  if (!m) return null;
  try { return new Date(`${m[1]} ${m[2]}, ${m[3]}`).toISOString(); }
  catch { return null; }
}

// Derive a tier label from the event name
function eventTier(name) {
  const n = name.toLowerCase();
  if (n.includes('world')) return 'Worlds';
  if (n.includes('international')) return 'International';
  if (n.includes('special')) return 'Special';
  if (n.includes('regional')) return 'Regional';
  return null;
}

// ── Scrape tournament list ─────────────────────────────────────────────────────
// Returns [{ id, name, date, tier }] for all SV-era VGC tournaments on RK9.
async function scrapeRk9Tournaments() {
  console.log('[rk9Sync] Scraping tournament list from RK9...');
  const html = await fetchHtml(`${RK9_BASE}/events/pokemon?past=true`);
  if (!html) throw new Error('Failed to fetch RK9 events page');

  const $ = cheerio.load(html);
  const tournaments = [];

  $('#dtPastEvents tbody tr').each((_, row) => {
    const cells = $(row).find('td');
    if (cells.length < 5) return;

    const dateText = $(cells[0]).text().trim();
    const name     = $(cells[2]).find('a').first().text().trim();
    const date     = parseRk9Date(dateText);

    // Filter: Champions Era only (Sep 2025+)
    if (!date || new Date(date).getTime() < CHAMPIONS_ERA_START) return;

    // Find the VGC-specific tournament link (text == "VG")
    let vgId = null;
    $(cells[4]).find('a').each((_, a) => {
      const text = $(a).text().trim();
      const href = $(a).attr('href') || '';
      if (text === 'VG' && href.startsWith('/tournament/')) {
        vgId = href.replace('/tournament/', '').trim();
      }
    });

    if (!vgId) return; // no VGC section for this event

    // Skip events with "Custom" in the name (shouldn't happen on RK9, but just in case)
    if (name.toLowerCase().includes('custom')) return;

    tournaments.push({ id: vgId, name, date, tier: eventTier(name) });
  });

  console.log(`[rk9Sync] Found ${tournaments.length} SV-era VGC tournaments`);
  return tournaments;
}

// ── Scrape roster for one tournament ──────────────────────────────────────────
// Returns { players (total Masters count), top (array of { name, country, standing, playerId }) }
async function scrapeRk9Roster(tournamentId, topN = 64) {
  const html = await fetchHtml(`${RK9_BASE}/roster/${tournamentId}`);
  if (!html) return { players: 0, top: [] };

  const $ = cheerio.load(html);
  const all = [];

  $('#dtLiveRoster tbody tr').each((_, row) => {
    const cells = $(row).find('td');
    if (cells.length < 7) return;

    const division = $(cells[4]).text().trim();
    if (division !== 'Masters') return;

    const firstName   = $(cells[1]).text().trim();
    const lastName    = $(cells[2]).text().trim();
    const country     = $(cells[3]).text().trim();
    const teamLink    = $(cells[6]).find('a').attr('href') || '';
    const standingRaw = $(cells[7]).text().trim();
    const standing    = parseInt(standingRaw) || 9999;

    if (!teamLink) return; // no team list

    const playerId = teamLink.split('/').pop();
    all.push({
      name: `${firstName} ${lastName}`.trim(),
      country: country || null,
      standing,
      playerId,
    });
  });

  all.sort((a, b) => a.standing - b.standing);
  return { players: all.length, top: all.slice(0, topN) };
}

// ── Scrape one team list page ──────────────────────────────────────────────────
// Returns array of { name, item, ability, moves, teraType, statAlignment } (6 Pokémon, EN only)
async function scrapeRk9TeamList(tournamentId, playerId) {
  const html = await fetchHtml(`${RK9_BASE}/teamlist/public/${tournamentId}/${playerId}`);
  if (!html) return null;

  const $ = cheerio.load(html);
  const team = [];

  $('div.pokemon').each((_, div) => {
    const $div = $(div);

    // Only parse EN blocks (first <b> tag = language code)
    const lang = $div.find('b').first().text().trim();
    if (lang !== 'EN') return;

    // Pokémon name: first substantial text node (after img, before &nbsp;)
    let name = '';
    $div.contents().each((_, node) => {
      if (node.type === 'text') {
        const t = node.data.replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
        if (t.length > 1) { name = t; return false; } // break
      }
    });

    // Parse bold label → next text node value
    let teraType = null, ability = '', item = '', statAlignment = null;
    $div.find('b').each((_, b) => {
      const label = $(b).text().trim();
      const next  = b.nextSibling;
      const val   = next && next.type === 'text'
        ? next.data.replace(/ /g, ' ').trim()
        : '';

      if (label === 'Tera Type:') teraType = val || null;
      else if (label === 'Ability:') ability = val;
      else if (label === 'Held Item:') item = val;
      else if (label === 'Stat Alignment:') statAlignment = val || null;
    });

    // Moves from span.badge
    const moves = $div.find('span.badge')
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(Boolean);

    if (name) team.push({ name, item, ability, moves, teraType, statAlignment });
  });

  return team.length > 0 ? team : null;
}

// ── Main sync ──────────────────────────────────────────────────────────────────
// Syncs all SV-era VGC tournaments from RK9. Fetches rosters + top-N team lists.
async function syncRk9(topN = 64) {
  console.log(`[rk9Sync] Starting RK9 sync (top ${topN} players per tournament)`);
  const db = await getDb();
  const now = new Date().toISOString();

  const tournaments = await scrapeRk9Tournaments();
  if (tournaments.length === 0) {
    console.log('[rk9Sync] No tournaments found');
    return { synced: 0, at: now };
  }

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

  let syncedCount = 0;

  // Process tournaments one at a time (roster + team lists)
  // — conservative concurrency to avoid rate limiting
  for (const t of tournaments) {
    console.log(`[rk9Sync] Processing: ${t.name}`);
    await delay(400); // pause between tournaments

    const { players, top } = await scrapeRk9Roster(t.id, topN);
    if (top.length === 0) {
      console.log(`[rk9Sync]   No Masters roster found, skipping`);
      continue;
    }

    // Fetch team lists for top players in batches of 3 with 600ms pause
    const withTeams = await batchedMap(top, async (player) => {
      const team = await scrapeRk9TeamList(t.id, player.playerId);
      return { ...player, team };
    }, 3, 600);

    // Build standings array
    const standings = withTeams.map(p => ({
      placing:  p.standing === 9999 ? null : p.standing,
      name:     p.name,
      country:  p.country,
      record:   null, // RK9 doesn't expose win/loss records on the roster
      team:     p.team,
    }));

    // Upsert tournament + standings in one transaction
    db.transaction(() => {
      upsertTournament.run({
        id:        t.id,
        name:      t.name,
        date:      t.date,
        players,
        format:    t.tier,
        has_lists: 1,
        source:    'rk9',
        synced_at: now,
      });
      upsertStandings.run({
        tournament_id:  t.id,
        standings_json: JSON.stringify(standings),
        synced_at:      now,
      });
    })();

    syncedCount++;
    console.log(`[rk9Sync]   ✓ ${t.name} — ${players} players, ${standings.filter(s => s.team).length} with team lists`);
  }

  flushToDisk();
  console.log(`[rk9Sync] Done — ${syncedCount} tournaments synced`);
  return { synced: syncedCount, at: now };
}

module.exports = { syncRk9, scrapeRk9Tournaments, scrapeRk9Roster, scrapeRk9TeamList };
