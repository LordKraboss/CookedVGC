// routes/index.js — 100% Smogon/Showdown, zero PokeAPI
const express = require("express");
const { getDb } = require("../db/schema");
const { syncAll, syncRegulation } = require("../services/smogonSync");
const { refreshPokedex } = require("../services/showdownData");
const { getAllRegs, getRegById, getActiveReg } = require("../../../shared/regulations");
const { loadMoveDex, loadAbilityDex, loadItemDex, loadPokedex, toShowdownId, getPokemonGen9Moves } = require("../services/showdownData");
const { getLocalSpriteUrl } = require("../services/sprites");
const { getLegalChampionsItems, getChampionsMoveDex, loadItemDescriptions, loadItemCategories } = require("../services/championsData");

function norm(s) { return (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, ''); }

/** Returns the local sprite URL if cached, otherwise null (no CDN fallback). */
function spriteUrl(name) { return getLocalSpriteUrl(name); }
const { getStoredLearnset } = require("../services/smogonLearnsets");

const router = express.Router();

// Admin guard for destructive sync endpoints. Fails closed: the route is blocked
// unless ADMIN_TOKEN is set in the environment AND the request presents a matching
// `x-admin-token` header. With no ADMIN_TOKEN set (the default), nobody can trigger it.
function requireAdmin(req, res, next) {
  const token = process.env.ADMIN_TOKEN;
  if (!token || req.get("x-admin-token") !== token) {
    return res.status(403).json({ error: "Forbidden" });
  }
  next();
}

// Live tournament subsystem (create/join/lobby/launch/results).
// Mounted under /tourney to avoid colliding with the RK9 /tournaments/* cache.
router.use('/tourney', require('./tournaments'));

function resolveReg(query) {
  return query?.reg ? getRegById(query.reg) ?? getActiveReg() : getActiveReg();
}

// Helper: get latest synced month for a reg
function getMonth(db, regId) {
  return db.prepare("SELECT sync_month FROM regulations WHERE id = ?").get(regId)?.sync_month;
}

// ── Regulations ──────────────────────────────────────────────────────────────

router.get("/regulations", async (req, res) => {
  const db = await getDb();
  const rows = db.prepare("SELECT * FROM regulations").all();
  const byId = Object.fromEntries(rows.map(r => [r.id, r]));
  res.json(getAllRegs().map(r => ({
    ...r,
    syncMonth: byId[r.id]?.sync_month ?? null,
    lastSynced: byId[r.id]?.last_synced ?? null,
  })));
});

router.post("/regulations/sync", requireAdmin, async (req, res) => {
  const force = req.query.force === 'true';
  try { res.json({ ok: true, results: await syncAll(force) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post("/regulations/:id/sync", requireAdmin, async (req, res) => {
  const reg = getRegById(req.params.id);
  if (!reg) return res.status(404).json({ error: "Regulation not found" });
  const force = req.query.force === 'true';
  try {
    const result = await syncRegulation(reg, req.body?.month ?? null, force);
    res.json({ ok: true, ...result });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Force-refresh Showdown pokedex (after a game update)
router.post("/showdown/refresh", requireAdmin, async (req, res) => {
  try { await refreshPokedex(); res.json({ ok: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// Trigger learnset sync for a regulation (without re-syncing chaos data)
router.post("/regulations/:id/sync-learnsets", requireAdmin, async (req, res) => {
  const reg = getRegById(req.params.id);
  if (!reg) return res.status(404).json({ error: "Regulation not found" });
  const db = await getDb();
  const month = getMonth(db, reg.id);
  if (!month) return res.status(400).json({ error: "Regulation not synced yet" });
  const rows = db.prepare("SELECT name FROM pokemon_usage WHERE reg_id=? AND month=?").all(reg.id, month);
  const { syncLearnsets } = require("../services/smogonLearnsets");
  try {
    await syncLearnsets(reg, rows.map(r => r.name), { force: !!req.body?.force });
    res.json({ ok: true, count: rows.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Usage rankings ────────────────────────────────────────────────────────────

router.get("/usage", async (req, res) => {
  const reg = resolveReg(req.query);
  const db = await getDb();
  const month = getMonth(db, reg.id);

  // Base = full Champions Dex (pokemon_showdown); usage merged in — 0 if not seen
  // in battle. When the regulation has no synced month yet (e.g. a brand-new reg
  // Showdown hasn't published stats for), we still return the full roster at 0%
  // usage so the Meta Analysis page shows the dex instead of going blank.
  // For no-month regulations: scope to Pokémon with learnsets for this reg so we don't
  // bleed regma's data into the regmb view. Falls back to all of pokemon_showdown only
  // when learnset sync hasn't run yet (e.g. on first startup before Phase 2 completes).
  const learnsetScopeSql = `
    SELECT s.name,
           0 AS usage_pct, 0 AS raw_count,
           s.types_json, s.stats_json, NULL AS abilities_json
    FROM pokemon_showdown s
    WHERE lower(s.name) IN (
      SELECT lower(pokemon_name) FROM learnset_learners WHERE reg_id = ?
    )
    ORDER BY s.name ASC
  `;
  const fallbackScopeSql = `
    SELECT s.name,
           0 AS usage_pct, 0 AS raw_count,
           s.types_json, s.stats_json, NULL AS abilities_json
    FROM pokemon_showdown s
    ORDER BY s.name ASC
  `;

  // pokemon_showdown is a global (no reg_id) union of every reg's legal set, so it must be
  // scoped to this reg's learnset_learners or illegal formes (e.g. Arceus types) leak in.
  // Only fall back to the unscoped union when learnset sync hasn't run yet for the reg.
  const learnsetCount = db.prepare('SELECT COUNT(*) as n FROM learnset_learners WHERE reg_id=?').get(reg.id)?.n ?? 0;
  const legalScope = learnsetCount > 0
    ? 'WHERE lower(s.name) IN (SELECT lower(pokemon_name) FROM learnset_learners WHERE reg_id = ?)'
    : '';

  const rows = month
    ? db.prepare(`
        SELECT s.name,
               COALESCE(u.usage_pct, 0)  AS usage_pct,
               COALESCE(u.raw_count, 0)  AS raw_count,
               s.types_json, s.stats_json, m.abilities_json
        FROM pokemon_showdown s
        LEFT JOIN pokemon_usage u
          ON u.reg_id = ? AND u.month = ? AND lower(u.name) = lower(s.name)
        LEFT JOIN pokemon_meta m
          ON m.reg_id = ? AND m.month = ? AND lower(m.name) = lower(s.name)
        ${legalScope}
        ORDER BY usage_pct DESC
      `).all(...(learnsetCount > 0
        ? [reg.id, month, reg.id, month, reg.id]
        : [reg.id, month, reg.id, month]))
    : (learnsetCount > 0
        ? db.prepare(learnsetScopeSql).all(reg.id)
        : db.prepare(fallbackScopeSql).all());

  let pokedex = {};
  try { pokedex = await loadPokedex(); } catch {}

  res.json(rows.map(r => {
    const entry = pokedex[toShowdownId(r.name)];
    const allAbilities = entry?.abilities ? Object.values(entry.abilities).map(a => a.toLowerCase()) : [];
    return {
      name: r.name,
      usagePct: r.usage_pct,
      rawCount: r.raw_count,
      types: r.types_json ? JSON.parse(r.types_json) : [],
      stats: r.stats_json ? JSON.parse(r.stats_json) : null,
      spriteUrl: spriteUrl(r.name),
      abilities: r.abilities_json ? JSON.parse(r.abilities_json).slice(0, 3) : [],
      allAbilities,
    };
  }));
});

// ── Pokémon meta ──────────────────────────────────────────────────────────────

router.get("/pokemon/:name/meta", async (req, res) => {
  const reg = resolveReg(req.query);
  const db = await getDb();
  const month = getMonth(db, reg.id);

  if (!month) {
    // No chaos data yet — return basic data from pokemon_showdown so the team builder
    // and MetaAnalysis page can still show types/stats/sprite (just no usage details).
    const sdRow = db.prepare(
      'SELECT name, types_json, stats_json FROM pokemon_showdown WHERE lower(name)=lower(?)'
    ).get(req.params.name);
    if (!sdRow) return res.status(404).json({ error: "Pokémon not found in this regulation" });
    let pdxAbilities = [];
    try {
      const pdx = await loadPokedex();
      const entry = pdx[toShowdownId(sdRow.name)];
      if (entry?.abilities) {
        pdxAbilities = Object.values(entry.abilities)
          .filter(Boolean)
          .map(name => ({ name, pct: 0, displayName: name }));
      }
    } catch {}
    return res.json({
      name: sdRow.name,
      usagePct: 0,
      rawCount: 0,
      types:     sdRow.types_json  ? JSON.parse(sdRow.types_json)  : [],
      stats:     sdRow.stats_json  ? JSON.parse(sdRow.stats_json)  : {},
      spriteUrl: spriteUrl(sdRow.name),
      moves: [], items: [], spreads: [], abilities: pdxAbilities,
      allAbilities: pdxAbilities.map(a => a.name), teammates: [],
      regulation: { id: reg.id, label: reg.label, month: null },
    });
  }

  const row = db.prepare(`
    SELECT m.*, u.usage_pct, u.raw_count, s.types_json, s.stats_json, s.sprite_url
    FROM pokemon_meta m
    JOIN pokemon_usage u ON u.reg_id=m.reg_id AND u.month=m.month AND u.name=m.name
    LEFT JOIN pokemon_showdown s ON lower(s.name) = lower(m.name)
    WHERE m.reg_id=? AND m.month=? AND lower(m.name)=lower(?)
  `).get(reg.id, month, req.params.name);

  if (!row) return res.status(404).json({ error: "Pokémon not found in this regulation" });

  // Load dexes in parallel — all are cached in memory after first call.
  // Wrap in try/catch so a transient network failure doesn't crash the whole route.
  let moveDex = {}, itemDex = {}, abilityDex = {};
  try {
    [moveDex, itemDex, abilityDex] = await Promise.all([
      reg.dexGen === 'champions' ? getChampionsMoveDex() : loadMoveDex(),
      loadItemDex(),
      loadAbilityDex(),
    ]);
  } catch (err) {
    console.error('[meta] Failed to load enrichment dexes:', err.message);
    // Continue with empty dexes — displayName will fall back to the raw name
  }

  const rawMoves     = JSON.parse(row.moves_json);
  const rawItems     = JSON.parse(row.items_json);
  const rawAbilities = JSON.parse(row.abilities_json);

  // Full legal ability set from the pokedex (usage data only lists abilities actually run)
  let allAbilities = [];
  try {
    const pdx = await loadPokedex();
    const entry = pdx[toShowdownId(row.name)];
    if (entry?.abilities) allAbilities = Object.values(entry.abilities).filter(Boolean);
  } catch {}

  // Enrich moves: add display name, type, and flags so the frontend needs zero extra calls
  const enrichedMoves = rawMoves.map(m => {
    const id    = norm(m.name);
    const entry = moveDex[id] ?? {};
    return {
      ...m,
      displayName: entry.name ?? m.name,
      type:        entry.type?.toLowerCase() ?? null,
      flags:       entry.flags ?? {},
    };
  });

  // Enrich items: add display name
  const enrichedItems = rawItems.map(it => ({
    ...it,
    displayName: itemDex[norm(it.name)] ?? it.name,
  }));

  // Enrich abilities: add display name
  const enrichedAbilities = rawAbilities.map(ab => ({
    ...ab,
    displayName: abilityDex[norm(ab.name)] ?? ab.name,
  }));

  res.json({
    name: row.name,
    usagePct: row.usage_pct,
    rawCount: row.raw_count,
    types: row.types_json ? JSON.parse(row.types_json) : [],
    stats: row.stats_json ? JSON.parse(row.stats_json) : {},
    spriteUrl: spriteUrl(row.name),
    moves:     enrichedMoves,
    items:     enrichedItems,
    spreads:   JSON.parse(row.spreads_json),
    abilities: enrichedAbilities,
    allAbilities,
    teammates: JSON.parse(row.teammates_json).map(t => ({ ...t, spriteUrl: spriteUrl(t.name) })),
    regulation: { id: reg.id, label: reg.label, month },
  });
});

// ── Pokémon learnset (enriched with move details) ────────────────────────────
router.get("/pokemon/:name/learnset", async (req, res) => {
  const reg  = resolveReg(req.query);
  const name = req.params.name;

  let learnset;
  try { learnset = await getStoredLearnset(reg.id, name); }
  catch (err) { return res.status(500).json({ error: err.message }); }

  if (!learnset?.length) return res.json([]);

  let moveDex = {};
  try { moveDex = await loadMoveDex(); } catch {}

  const moves = learnset.map(moveName => {
    const id    = norm(moveName);
    const entry = moveDex[id] ?? {};
    return {
      name:      entry.name ?? moveName,
      type:      entry.type?.toLowerCase() ?? null,
      category:  entry.category ?? null,
      basePower: entry.basePower ?? 0,
      // accuracy: true in Showdown means "always hits" — map to null
      accuracy:  entry.accuracy === true ? null : (entry.accuracy ?? null),
      pp:        entry.pp ?? null,
      priority:  entry.priority ?? 0,
      // Keep only active flags (value truthy) and translate to readable keys
      flags: entry.flags
        ? Object.keys(entry.flags).filter(k => entry.flags[k])
        : [],
      shortDesc: entry.shortDesc ?? '',
    };
  });

  // Priority moves first, then sort by type, then alphabetically
  moves.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    const ta = a.type ?? 'zzz', tb = b.type ?? 'zzz';
    if (ta !== tb) return ta.localeCompare(tb);
    return a.name.localeCompare(b.name);
  });

  res.json(moves);
});

// ── Multi-move Pokémon filter ─────────────────────────────────────────────────
// Returns Pokémon that can legally use ALL of the requested moves.
// Prefers learnset_learners (format-legal) with fallback to move_learners (usage).

router.get("/pokemon/by-moves", async (req, res) => {
  const reg = resolveReg(req.query);
  const db = await getDb();
  const month = getMonth(db, reg.id);

  const raw = req.query.moves ?? '';
  const moveNorms = raw.split(',')
    .map(m => m.trim().toLowerCase().replace(/[\s\-]+/g, ''))
    .filter(Boolean);

  if (moveNorms.length === 0) return res.json([]);

  if (!month) {
    // Prefer learnset_learners for this regulation (reg-scoped, fast, already in DB).
    // Only fall back to the expensive Gen 9 global learnset path when learnsets haven't
    // been synced yet — avoids 200+ concurrent fetches that can stall the server.
    const learnsetCount = db.prepare('SELECT COUNT(*) as n FROM learnset_learners WHERE reg_id=?').get(reg.id)?.n ?? 0;
    if (learnsetCount > 0) {
      const placeholders = moveNorms.map(() => '?').join(',');
      const rows = db.prepare(`
        SELECT ll.pokemon_name, s.types_json, s.stats_json
        FROM learnset_learners ll
        LEFT JOIN pokemon_showdown s ON lower(s.name) = lower(ll.pokemon_name)
        WHERE ll.reg_id = ? AND ll.move_norm IN (${placeholders})
        GROUP BY ll.pokemon_name
        HAVING COUNT(DISTINCT ll.move_norm) = ?
        ORDER BY ll.pokemon_name
      `).all(reg.id, ...moveNorms, moveNorms.length);
      let pokedexLL = {};
      try { pokedexLL = await loadPokedex(); } catch {}
      return res.json(rows.map(r => {
        const entry = pokedexLL[toShowdownId(r.pokemon_name)];
        const allAbilities = entry?.abilities ? Object.values(entry.abilities).map(a => a.toLowerCase()) : [];
        return {
          name: r.pokemon_name,
          usagePct: 0,
          types: r.types_json ? JSON.parse(r.types_json) : [],
          stats: r.stats_json ? JSON.parse(r.stats_json) : null,
          spriteUrl: spriteUrl(r.pokemon_name),
          abilities: allAbilities.slice(0, 3).map(name => ({ name })),
          allAbilities,
        };
      }));
    }

    // Fallback: determine legality from the global Gen 9 learnsets.
    // NOTE: loads learnsets.json once and reuses the in-memory cache for subsequent
    // requests. The first call after a cold start may take a second or two.
    try {
      const wanted = raw.split(',').map(norm).filter(Boolean);
      const species = db.prepare(
        `SELECT name, types_json, stats_json FROM pokemon_showdown`
      ).all();
      const legalLists = await Promise.all(species.map(sp => getPokemonGen9Moves(sp.name)));
      let pokedexFB = {};
      try { pokedexFB = await loadPokedex(); } catch {}
      const out = [];
      species.forEach((sp, i) => {
        const legal = legalLists[i];
        if (wanted.every(w => legal.has(w))) {
          const entry = pokedexFB[toShowdownId(sp.name)];
          const allAbilities = entry?.abilities
            ? Object.values(entry.abilities).map(a => a.toLowerCase()) : [];
          out.push({
            name: sp.name,
            usagePct: 0,
            types: sp.types_json ? JSON.parse(sp.types_json) : [],
            stats: sp.stats_json ? JSON.parse(sp.stats_json) : null,
            spriteUrl: spriteUrl(sp.name),
            abilities: allAbilities.slice(0, 3).map(name => ({ name })),
            allAbilities,
          });
        }
      });
      out.sort((a, b) => a.name.localeCompare(b.name));
      return res.json(out);
    } catch { return res.json([]); }
  }

  const placeholders = moveNorms.map(() => '?').join(',');

  // Check if learnset data is available for this regulation
  const learnsetCount = db.prepare(
    'SELECT COUNT(*) as n FROM learnset_learners WHERE reg_id=?'
  ).get(reg.id)?.n ?? 0;

  let rows;
  if (learnsetCount > 0) {
    // Use learnset_learners: covers all format-legal moves, not just those seen in usage
    rows = db.prepare(`
      SELECT ll.pokemon_name,
             u.usage_pct,
             s.types_json, s.stats_json, s.sprite_url,
             m.abilities_json
      FROM learnset_learners ll
      LEFT JOIN pokemon_usage u
        ON u.reg_id=ll.reg_id AND u.month=? AND lower(u.name)=lower(ll.pokemon_name)
      LEFT JOIN pokemon_showdown s ON lower(s.name)=lower(ll.pokemon_name)
      LEFT JOIN pokemon_meta m
        ON m.reg_id=ll.reg_id AND m.month=? AND lower(m.name)=lower(ll.pokemon_name)
      WHERE ll.reg_id=? AND ll.move_norm IN (${placeholders})
      GROUP BY ll.pokemon_name
      HAVING COUNT(DISTINCT ll.move_norm)=?
      ORDER BY u.usage_pct DESC NULLS LAST
    `).all(month, month, reg.id, ...moveNorms, moveNorms.length);
  } else {
    // Fallback: move_learners (only usage-based data)
    rows = db.prepare(`
      SELECT ml.pokemon_name, u.usage_pct, s.types_json, s.stats_json, s.sprite_url, m.abilities_json
      FROM move_learners ml
      LEFT JOIN pokemon_usage u
        ON u.reg_id=ml.reg_id AND u.month=ml.month AND lower(u.name)=lower(ml.pokemon_name)
      LEFT JOIN pokemon_showdown s ON lower(s.name)=lower(ml.pokemon_name)
      LEFT JOIN pokemon_meta m ON m.reg_id=ml.reg_id AND m.month=ml.month AND lower(m.name)=lower(ml.pokemon_name)
      WHERE ml.reg_id=? AND ml.month=?
        AND replace(replace(ml.move_name,' ',''),'-','') IN (${placeholders})
      GROUP BY ml.pokemon_name
      HAVING COUNT(DISTINCT replace(replace(ml.move_name,' ',''),'-',''))=?
      ORDER BY u.usage_pct DESC
    `).all(reg.id, month, ...moveNorms, moveNorms.length);
  }

  let pokedex2 = {};
  try { pokedex2 = await loadPokedex(); } catch {}

  res.json(rows.map(r => {
    const entry = pokedex2[toShowdownId(r.pokemon_name)];
    const allAbilities = entry?.abilities ? Object.values(entry.abilities).map(a => a.toLowerCase()) : [];
    return {
      name: r.pokemon_name,
      usagePct: r.usage_pct ?? 0,
      types: r.types_json ? JSON.parse(r.types_json) : [],
      stats: r.stats_json ? JSON.parse(r.stats_json) : null,
      spriteUrl: spriteUrl(r.pokemon_name),
      abilities: r.abilities_json ? JSON.parse(r.abilities_json).slice(0, 3) : [],
      allAbilities,
    };
  }));
});

// ── Type / ability filter (VGC-scoped) ───────────────────────────────────────
// Source: pokemon_showdown table — only Pokémon synced from Smogon VGC stats.
// This avoids flooding results with non-VGC Pokémon from the full Showdown
// pokedex. The Showdown pokedex is still used for ability lookups, since
// pokemon_showdown only stores types and base stats.

router.get("/pokemon/by-filter", async (req, res) => {
  const reg = resolveReg(req.query);
  const db  = await getDb();

  const typeFilters   = (req.query.types   ?? '').split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
  const abilityFilter = (req.query.ability ?? '').toLowerCase().trim();
  if (!typeFilters.length && !abilityFilter) return res.json([]);

  // Pokedex is cached in memory — ability lookups are instant after first load.
  let pokedex = {};
  try { pokedex = await loadPokedex(); } catch {}

  const month = getMonth(db, reg.id);

  // Build usage + meta maps for the current regulation
  const usageMap = new Map();
  const metaMap  = new Map();
  if (month) {
    for (const r of db.prepare(
      "SELECT name, usage_pct, raw_count FROM pokemon_usage WHERE reg_id=? AND month=?"
    ).all(reg.id, month))
      usageMap.set(r.name.toLowerCase(), r);
    for (const r of db.prepare(
      "SELECT name, abilities_json FROM pokemon_meta WHERE reg_id=? AND month=?"
    ).all(reg.id, month))
      metaMap.set(r.name.toLowerCase(), r);
  }

  // Iterate pokemon_showdown (VGC-relevant Pokémon only, not the full ~1000-entry
  // Showdown pokedex). Types come from the DB; abilities from the pokedex.
  const showdownRows = db.prepare(
    "SELECT name, types_json, stats_json FROM pokemon_showdown"
  ).all();

  const results = [];
  for (const s of showdownRows) {
    const name  = s.name;
    const key   = name.toLowerCase();
    const types = s.types_json ? JSON.parse(s.types_json) : [];

    // Type filter — types_json is already lowercase from the sync
    if (typeFilters.length && !typeFilters.every(t => types.includes(t))) continue;

    // Ability filter — use all possible abilities from the Showdown pokedex
    const pdxEntry    = pokedex[toShowdownId(name)];
    const allAbilities = pdxEntry?.abilities
      ? Object.values(pdxEntry.abilities).map(a => a.toLowerCase())
      : [];
    if (abilityFilter && !allAbilities.some(a => norm(a).includes(norm(abilityFilter)))) continue;

    const u = usageMap.get(key);
    const m = metaMap.get(key);

    results.push({
      name,
      usagePct:    u?.usage_pct ?? 0,
      rawCount:    u?.raw_count ?? 0,
      types,
      stats:       s.stats_json ? JSON.parse(s.stats_json) : null,
      spriteUrl:   spriteUrl(name),
      abilities:   m?.abilities_json ? JSON.parse(m.abilities_json).slice(0, 3) : [],
      allAbilities,
    });
  }

  results.sort((a, b) => {
    if (a.usagePct === null && b.usagePct === null) return 0;
    if (a.usagePct === null) return 1;
    if (b.usagePct === null) return -1;
    return b.usagePct - a.usagePct;
  });

  res.json(results);
});

// ── Autocomplete suggestions ──────────────────────────────────────────────────

router.get("/pokemon/suggest", async (req, res) => {
  const reg = resolveReg(req.query);
  const db = await getDb();
  const month = getMonth(db, reg.id);
  const q = (req.query.q ?? '').toLowerCase();
  if (q.length < 3) return res.json([]);
  if (!month) {
    // No usage yet — suggest from the cross-reg Showdown dex roster instead.
    const rows = db.prepare(`
      SELECT name FROM pokemon_showdown WHERE lower(name) LIKE ? ORDER BY name LIMIT 10
    `).all(`%${q}%`);
    return res.json(rows.map(r => r.name));
  }
  const rows = db.prepare(`
    SELECT name FROM pokemon_usage
    WHERE reg_id=? AND month=? AND lower(name) LIKE ?
    ORDER BY usage_pct DESC LIMIT 10
  `).all(reg.id, month, `%${q}%`);
  res.json(rows.map(r => r.name));
});

router.get("/items/suggest", async (req, res) => {
  const reg = resolveReg(req.query);
  const db = await getDb();
  const month = getMonth(db, reg.id);
  const q = (req.query.q ?? '').toLowerCase();
  if (q.length < 2) return res.json([]);

  // Champions regulations: the legal item pool is the base, chaos % only orders it.
  if (reg.dexGen === 'champions') {
    try {
      const legal = await getLegalChampionsItems();
      const usage = new Map();
      if (month) {
        for (const row of db.prepare(
          `SELECT items_json FROM pokemon_meta WHERE reg_id=? AND month=?`
        ).all(reg.id, month)) {
          for (const item of JSON.parse(row.items_json))
            usage.set(norm(item.name), (usage.get(norm(item.name)) ?? 0) + item.pct);
        }
      }
      const out = legal
        .filter(it => it.name.toLowerCase().includes(q))
        .sort((a, b) =>
          (usage.get(b.id) ?? 0) - (usage.get(a.id) ?? 0) || a.name.localeCompare(b.name))
        .slice(0, 10)
        .map(it => it.name);
      return res.json(out);
    } catch { /* fall through to non-champions behaviour */ }
  }

  if (!month) {
    // No usage yet — suggest from the global Showdown item dex.
    try {
      const dex = await loadItemDex();
      const out = [...new Set(Object.values(dex))]
        .filter(n => n.toLowerCase().includes(q)).sort().slice(0, 10);
      return res.json(out);
    } catch { return res.json([]); }
  }

  const rows = db.prepare(
    `SELECT items_json FROM pokemon_meta WHERE reg_id=? AND month=?`
  ).all(reg.id, month);

  const totals = new Map();
  for (const row of rows) {
    for (const item of JSON.parse(row.items_json)) {
      if (item.name.toLowerCase().includes(q))
        totals.set(item.name, (totals.get(item.name) ?? 0) + item.pct);
    }
  }

  res.json(
    [...totals.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name]) => name)
  );
});

router.get("/abilities/suggest", async (req, res) => {
  const reg = resolveReg(req.query);
  const db = await getDb();
  const month = getMonth(db, reg.id);
  const q = (req.query.q ?? '').toLowerCase();
  if (q.length < 3) return res.json([]);
  if (!month) {
    // No usage yet — suggest from the global Showdown ability dex.
    try {
      const dex = await loadAbilityDex();
      const out = [...new Set(Object.values(dex))]
        .filter(n => n.toLowerCase().includes(q)).sort().slice(0, 10);
      return res.json(out);
    } catch { return res.json([]); }
  }
  const rows = db.prepare(`
    SELECT DISTINCT ability_name FROM pokemon_abilities
    WHERE reg_id=? AND month=? AND ability_name LIKE ?
    ORDER BY ability_name LIMIT 10
  `).all(reg.id, month, `%${q}%`);
  res.json(rows.map(r => r.ability_name));
});

// Returns proper display names for a list of ability IDs / names (from Showdown source).
router.get("/abilities/details", async (req, res) => {
  const names = (req.query.names ?? '').split(',').map(s => s.trim()).filter(Boolean);
  if (!names.length) return res.json({});
  try {
    const dex = await loadAbilityDex();
    const result = {};
    for (const name of names) {
      const display = dex[norm(name)];
      result[name] = display ? { name: display } : null;
    }
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Returns proper display names for a list of item IDs / names (from Showdown source).
router.get("/items/details", async (req, res) => {
  const names = (req.query.names ?? '').split(',').map(s => s.trim()).filter(Boolean);
  if (!names.length) return res.json({});
  try {
    const dex = await loadItemDex();
    const result = {};
    for (const name of names) {
      const display = dex[norm(name)];
      result[name] = display ? { name: display } : null;
    }
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Full legal item catalogue for a regulation, with what each item does.
// Champions regs use the restricted legal pool; others fall back to the full
// Showdown item dex. Ordered by chaos usage % when a month exists, else alpha.
router.get("/items/legal", async (req, res) => {
  const reg = resolveReg(req.query);
  const db = await getDb();
  const month = getMonth(db, reg.id);
  try {
    const [texts, categories] = await Promise.all([loadItemDescriptions(), loadItemCategories()]);

    // Aggregate item usage % across the meta (sum of per-Pokémon item shares).
    const usage = new Map();
    if (month) {
      for (const row of db.prepare(
        `SELECT items_json FROM pokemon_meta WHERE reg_id=? AND month=?`
      ).all(reg.id, month)) {
        for (const item of JSON.parse(row.items_json))
          usage.set(norm(item.name), (usage.get(norm(item.name)) ?? 0) + item.pct);
      }
    }

    let pool;
    if (reg.dexGen === 'champions') {
      pool = await getLegalChampionsItems();                 // [{ id, name }]
    } else {
      const dex = await loadItemDex();                        // { id: name }
      pool = Object.entries(dex).map(([id, name]) => ({ id, name }));
    }

    const flagsSeen = new Set();
    const items = pool.map(({ id, name }) => {
      const t = texts[id] ?? {};
      const flags = categories[id] ?? [];
      flags.forEach(f => flagsSeen.add(f));
      return {
        id, name,
        desc: t.shortDesc ?? t.desc ?? null,
        flags,
        usagePct: usage.get(id) ?? 0,
      };
    }).sort((a, b) => b.usagePct - a.usagePct || a.name.localeCompare(b.name));

    res.json({ reg: reg.id, hasUsage: !!month, count: items.length, flags: [...flagsSeen], items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/moves/suggest", async (req, res) => {
  const reg = resolveReg(req.query);
  const db = await getDb();
  const month = getMonth(db, reg.id);
  const q = (req.query.q ?? '').toLowerCase().replace(/[\s\-]+/g, '');
  if (q.length < 3) return res.json([]);
  const pokemon = (req.query.pokemon ?? '').trim();

  if (pokemon) {
    // Stored (Champions mod) learnset is the source of truth for move legality —
    // applies whether or not chaos usage data exists for this regulation.
    const learnset = await getStoredLearnset(reg.id, pokemon);
    if (learnset) {
      const results = learnset
        .filter(m => m.toLowerCase().replace(/[^a-z0-9]/g, '').includes(q))
        .sort()
        .slice(0, 10);
      return res.json(results);
    }
    // Fallback below: search all moves if learnset not yet synced
  }

  if (!month) {
    // No usage and no stored learnset — suggest from the global Showdown move data.
    // If a Pokémon is given, restrict to its Gen 9 legal moves; otherwise search all.
    try {
      const moveDex = await loadMoveDex();
      let names;
      if (pokemon) {
        const ids = await getPokemonGen9Moves(pokemon);
        names = [...ids].map(id => moveDex[id]?.name).filter(Boolean);
      } else {
        names = Object.values(moveDex).map(m => m.name).filter(Boolean);
      }
      const out = [...new Set(names)]
        .filter(n => n.toLowerCase().replace(/[^a-z0-9]/g, '').includes(q))
        .sort().slice(0, 10);
      return res.json(out);
    } catch { return res.json([]); }
  }

  // Prefer learnset data (format-legal moves) over usage-only data
  const learnsetCount = db.prepare('SELECT COUNT(*) as n FROM learnset_learners WHERE reg_id=?').get(reg.id)?.n ?? 0;
  if (learnsetCount > 0) {
    const rows = db.prepare(`
      SELECT DISTINCT move_display FROM learnset_learners
      WHERE reg_id=? AND move_norm LIKE ?
      ORDER BY move_display LIMIT 10
    `).all(reg.id, `%${q}%`);
    return res.json(rows.map(r => r.move_display));
  }

  const rows = db.prepare(`
    SELECT DISTINCT move_name FROM move_learners
    WHERE reg_id=? AND month=? AND replace(replace(move_name, ' ', ''), '-', '') LIKE ?
    ORDER BY move_name LIMIT 10
  `).all(reg.id, month, `%${q}%`);
  res.json(rows.map(r => r.move_name));
});

// ── Move types (batch) ────────────────────────────────────────────────────────

router.get("/moves/types", async (req, res) => {
  const reg = resolveReg(req.query);
  const names = (req.query.names ?? '').split(',').map(s => s.trim()).filter(Boolean);
  if (!names.length) return res.json({});
  try {
    const dex = reg.dexGen === 'champions' ? await getChampionsMoveDex() : await loadMoveDex();
    const result = {};
    for (const name of names) {
      const entry = dex[name.toLowerCase().replace(/[^a-z0-9]/g, "")];
      result[name] = entry?.type?.toLowerCase() ?? null;
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Returns type + category for a list of move names (for offensive coverage panel).
router.get("/moves/details", async (req, res) => {
  const reg = resolveReg(req.query);
  const names = (req.query.names ?? '').split(',').map(s => s.trim()).filter(Boolean);
  if (!names.length) return res.json({});
  try {
    const dex = reg.dexGen === 'champions' ? await getChampionsMoveDex() : await loadMoveDex();
    const result = {};
    for (const name of names) {
      const id = name.toLowerCase().replace(/[^a-z0-9]/g, "");
      const entry = dex[id];
      result[name] = entry
        ? { ...entry, type: entry.type?.toLowerCase() ?? null }
        : null;
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Move learners ─────────────────────────────────────────────────────────────
// Built entirely from chaos data — who actually used this move in real battles.

router.get("/moves/:move/learners", async (req, res) => {
  const reg = resolveReg(req.query);
  const db = await getDb();
  const month = getMonth(db, reg.id);
  if (!month) return res.status(404).json({ error: "Regulation not synced yet" });

  const moveRaw = req.params.move;
  const moveNorm = moveRaw.toLowerCase().replace(/[\s\-]+/g, '');

  const learners = db.prepare(`
    SELECT ml.pokemon_name, u.usage_pct, s.types_json, s.sprite_url
    FROM move_learners ml
    LEFT JOIN pokemon_usage u
      ON u.reg_id=ml.reg_id AND u.month=ml.month AND lower(u.name)=lower(ml.pokemon_name)
    LEFT JOIN pokemon_showdown s ON lower(s.name) = lower(ml.pokemon_name)
    WHERE ml.reg_id=? AND ml.month=?
      AND replace(replace(ml.move_name, ' ', ''), '-', '')=?
    ORDER BY u.usage_pct DESC
  `).all(reg.id, month, moveNorm);

  if (learners.length === 0) {
    return res.status(404).json({ error: `No Pokémon found using "${moveRaw}" in current meta` });
  }

  res.json({
    move: req.params.move,
    regulation: reg.id,
    month,
    learners: learners.map(r => ({
      name: r.pokemon_name,
      usagePct: r.usage_pct ?? 0,
      types: r.types_json ? JSON.parse(r.types_json) : [],
      spriteUrl: spriteUrl(r.pokemon_name),
    })),
    totalLearners: learners.length,
  });
});

// ── Team suggestions ──────────────────────────────────────────────────────────

router.post("/team/suggest", async (req, res) => {
  const reg = resolveReg(req.body);
  const db = await getDb();
  const month = getMonth(db, reg.id);
  if (!month) return res.json([]);

  const team = (req.body.team ?? []).map(n => n.toLowerCase());
  if (!team.length) return res.json([]);

  const placeholders = team.map(() => "?").join(",");
  const metaRows = db.prepare(`
    SELECT m.name, m.teammates_json
    FROM pokemon_meta m
    WHERE m.reg_id=? AND m.month=? AND lower(m.name) IN (${placeholders})
  `).all(reg.id, month, ...team);

  // Build rank maps in the same order as the team array so breakdown indices match
  const rankMapsByMember = {};
  const nameCase = {}; // lowercase → properly-cased name
  for (const row of metaRows) {
    const list = JSON.parse(row.teammates_json);
    const map = {};
    list.forEach((t, i) => {
      const key = t.name.toLowerCase();
      map[key] = i + 1;
      nameCase[key] = t.name;
    });
    map.__penalty__ = list.length + 1;
    rankMapsByMember[row.name.toLowerCase()] = map;
  }
  // Only team members that have meta data, preserved in team order
  const rankMaps = team
    .filter(n => rankMapsByMember[n])
    .map(n => rankMapsByMember[n]);

  // Collect all candidates (union across all lists, excluding team members)
  const candidates = new Set();
  for (const map of rankMaps) {
    for (const name of Object.keys(map)) {
      if (name === '__penalty__') continue;
      if (!team.includes(name)) candidates.add(name);
    }
  }

  // Score = sum of ranks; track individual ranks for display
  const scores = {};
  const breakdowns = {};
  for (const candidate of candidates) {
    const ranks = rankMaps.map(map => map[candidate] ?? map.__penalty__);
    scores[candidate] = ranks.reduce((a, b) => a + b, 0);
    breakdowns[candidate] = ranks;
  }

  // Sort ascending (lowest rank sum first)
  const suggestions = Object.entries(scores)
    .sort((a, b) => a[1] - b[1]).slice(0, 12)
    .map(([nameLower, score]) => {
      const name = nameCase[nameLower] ?? nameLower;
      const u = db.prepare(
        "SELECT usage_pct FROM pokemon_usage WHERE reg_id=? AND month=? AND lower(name)=?"
      ).get(reg.id, month, name.toLowerCase());
      const s = db.prepare(
        "SELECT types_json, stats_json, sprite_url FROM pokemon_showdown WHERE lower(name)=?"
      ).get(name.toLowerCase());
      const m = db.prepare(
        "SELECT abilities_json FROM pokemon_meta WHERE reg_id=? AND month=? AND lower(name)=?"
      ).get(reg.id, month, name.toLowerCase());
      return {
        name, score,
        ranks: breakdowns[nameLower] ?? [],
        usagePct: u?.usage_pct ?? null,
        types: s?.types_json ? JSON.parse(s.types_json) : [],
        stats: s?.stats_json ? JSON.parse(s.stats_json) : null,
        abilities: m?.abilities_json ? JSON.parse(m.abilities_json).slice(0, 3) : [],
        spriteUrl: spriteUrl(name),
      };
    });

  res.json(suggestions);
});

// ── Sprite management ─────────────────────────────────────────────────────────
// Manually trigger a sprite download for all Pokémon in the current regulation.
// Useful after first install or if sprites are missing.
router.post("/sprites/sync", requireAdmin, async (req, res) => {
  const reg = resolveReg(req.query);
  const db  = await getDb();
  const month = getMonth(db, reg.id);
  if (!month) return res.status(400).json({ error: "Regulation not synced yet" });

  const rows = db.prepare("SELECT name FROM pokemon_usage WHERE reg_id=? AND month=?").all(reg.id, month);
  const { downloadSprites } = require("../services/sprites");
  try {
    const result = await downloadSprites(rows.map(r => r.name));
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Tournament routes (DB-backed, Limitless TCG as source) ───────────────────
const { syncTournaments, syncStandings } = require('../services/tournamentSync');
const { syncRk9 }                        = require('../services/rk9Sync');

// POST /tournaments/sync-now  — emergency manual trigger, admin-only
router.post('/tournaments/sync-now', requireAdmin, async (req, res) => {
  try {
    const [limitless, rk9] = await Promise.allSettled([syncTournaments(), syncRk9()]);
    res.json({
      ok: true,
      limitless: limitless.status === 'fulfilled' ? limitless.value : { error: limitless.reason?.message },
      rk9:       rk9.status       === 'fulfilled' ? rk9.value       : { error: rk9.reason?.message },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /tournaments/vgc/formats
// Returns the distinct non-null format values stored in the DB (for filter dropdown).
// IMPORTANT: must be declared before /:id to avoid Express matching "formats" as an id.
router.get('/tournaments/vgc/formats', async (req, res) => {
  try {
    const db = await getDb();
    const rows = db.prepare(
      `SELECT DISTINCT format FROM tournaments
       WHERE format IS NOT NULL AND format != ''
         AND format NOT IN ('CUSTOM', 'SVI')
       ORDER BY format ASC`
    ).all();
    res.json(rows.map(r => r.format));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /tournaments/vgc?limit=50&minPlayers=0&format=REG-H&hasLists=1
// Reads from DB. All filters are optional.
//   limit      – max rows to return (default 50, max 200)
//   minPlayers – minimum player count (default 0 = all)
//   format     – exact format string filter (optional)
//   hasLists   – 1 = only tournaments with team lists (default 0 = all)
router.get('/tournaments/vgc', async (req, res) => {
  try {
    const db         = await getDb();
    const limit      = Math.min(parseInt(req.query.limit) || 200, 500);
    const minPlayers = parseInt(req.query.minPlayers) || 0;
    const format     = req.query.format ?? null;
    const source     = req.query.source ?? null;
    const since      = req.query.since  ?? null; // ISO date string — filter date >= since

    const conditions = ["has_lists = 1", "(format IS NULL OR format NOT IN ('CUSTOM', 'SVI'))"];
    const params     = {};

    if (minPlayers > 0) {
      conditions.push('players >= :minPlayers');
      params.minPlayers = minPlayers;
    }
    if (format) {
      conditions.push('format = :format');
      params.format = format;
    }
    if (source) {
      conditions.push('source = :source');
      params.source = source;
    }
    if (since) {
      conditions.push('date >= :since');
      params.since = since;
    }

    const where = conditions.join(' AND ');
    const rows  = db.prepare(
      `SELECT id, name, date, players, format, has_lists, source, synced_at
       FROM tournaments
       WHERE ${where}
       ORDER BY date DESC
       LIMIT :limit`
    ).all({ ...params, limit });

    const tournaments = rows.map(r => ({
      id:        r.id,
      name:      r.name,
      date:      r.date,
      players:   r.players,
      format:    r.format,
      hasLists:  r.has_lists === 1,
      source:    r.source ?? 'limitless',
      syncedAt:  r.synced_at,
    }));

    // Include DB stats so the frontend can show "N tournaments · last synced X"
    const meta = db.prepare(
      `SELECT COUNT(*) as total, MAX(synced_at) as last_sync FROM tournaments`
    ).get();

    res.json({ tournaments, total: meta?.total ?? 0, lastSync: meta?.last_sync ?? null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /tournaments/vgc/:id/standings
// Returns standings from DB cache. If not yet cached, fetches from Limitless + stores.
router.get('/tournaments/vgc/:id/standings', async (req, res) => {
  try {
    const db  = await getDb();
    const id  = req.params.id;
    const row = db.prepare(
      `SELECT standings_json FROM tournament_standings WHERE tournament_id = :id`
    ).get({ id });

    if (row) {
      return res.json(JSON.parse(row.standings_json));
    }

    // Not in cache — fetch from Limitless and store
    const standings = await syncStandings(id);
    res.json(standings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
