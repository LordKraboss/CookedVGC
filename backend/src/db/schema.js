// db/schema.js — uses sql.js (pure JavaScript SQLite, no native compilation)
// Persists the database to disk as a binary file via fs.
const initSqlJs = require("sql.js");
const fs   = require("fs");
const path = require("path");

const DB_PATH = path.join(__dirname, "../../data/vgc.db");

let _db = null;
let _saveTimer = null;

// sql.js is async on init, so we expose an async getter
async function getDb() {
  if (_db) return _db;

  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    _db = new SQL.Database(fileBuffer);
  } else {
    _db = new SQL.Database();
  }

  // Persist to disk after every write — called by saveToDisk()
  return _db;
}

// Immediately write DB to disk — only call when you MUST persist right now.
function _writeToDisk() {
  if (!_db) return;
  try {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    const data = _db.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
  } catch (err) {
    console.error('[db] saveToDisk error:', err.message);
  }
}

// Debounced save — coalesces rapid writes (e.g. sync loops) into one disk write.
// Scheduled 400 ms after the last change; a burst of 27 000 writes = 1 flush.
function saveToDisk() {
  if (!_db) return;
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => { _saveTimer = null; _writeToDisk(); }, 400);
}

// Force an immediate flush — call before process exit or after critical operations.
function flushToDisk() {
  if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; }
  _writeToDisk();
}

// ── sql.js compatibility shim ─────────────────────────────────────────────────
// sql.js has a different API than better-sqlite3.
// This thin wrapper makes it look synchronous and familiar:
//   db.prepare(sql).run(params)   → executes with named params
//   db.prepare(sql).get(params)   → returns first row as object
//   db.prepare(sql).all(params)   → returns all rows as objects
//   db.exec(sql)                  → runs raw SQL (no params)
//   db.transaction(fn)()          → runs fn() then saves to disk

function wrapDb(sqlJsDb) {
  let _inTransaction = false;

  function colsAndRows(stmt) {
    const cols = stmt.getColumnNames();
    const rows = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      rows.push(row);
    }
    stmt.free();
    return rows;
  }

  return {
    exec(sql) {
      sqlJsDb.run(sql);
      saveToDisk();
    },

    prepare(sql) {
      return {
        run(...args) {
          if (args.length === 1 && typeof args[0] === "object" && args[0] !== null && !Array.isArray(args[0])) {
            const named = {};
            for (const [k, v] of Object.entries(args[0])) named[`:${k}`] = v;
            sqlJsDb.run(sql, named);
          } else {
            sqlJsDb.run(sql, args);
          }
          if (!_inTransaction) saveToDisk();
        },
        get(...args) {
          // Support both .get(obj) and .get(val1, val2, ...) positional
          let params = {};
          if (args.length === 1 && typeof args[0] === "object" && args[0] !== null) {
            for (const [k, v] of Object.entries(args[0])) params[`:${k}`] = v;
          } else {
            // positional — sql.js accepts arrays for ? placeholders
            params = args;
          }
          const stmt = sqlJsDb.prepare(sql);
          stmt.bind(typeof params === "object" && !Array.isArray(params) ? params : params);
          const rows = [];
          while (stmt.step()) rows.push(stmt.getAsObject());
          stmt.free();
          return rows[0] ?? null;
        },
        all(...args) {
          let params = {};
          if (args.length === 1 && typeof args[0] === "object" && args[0] !== null) {
            for (const [k, v] of Object.entries(args[0])) params[`:${k}`] = v;
          } else {
            params = args;
          }
          const stmt = sqlJsDb.prepare(sql);
          stmt.bind(typeof params === "object" && !Array.isArray(params) ? params : params);
          const rows = [];
          while (stmt.step()) rows.push(stmt.getAsObject());
          stmt.free();
          return rows;
        },
      };
    },

    transaction(fn) {
      return (...args) => {
        _inTransaction = true;
        sqlJsDb.run("BEGIN");
        try {
          fn(...args);
          sqlJsDb.run("COMMIT");
          _inTransaction = false;
          flushToDisk(); // flush immediately after a committed transaction
        } catch (e) {
          _inTransaction = false;
          try { sqlJsDb.run("ROLLBACK"); } catch (_) {}
          throw e;
        }
      };
    },
  };
}

let _wrapped = null;
async function getWrappedDb() {
  if (_wrapped) return _wrapped;
  const raw = await getDb();
  _wrapped = wrapDb(raw);
  return _wrapped;
}

// ── Schema ────────────────────────────────────────────────────────────────────
async function initSchema() {
  const db = await getWrappedDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS regulations (
      id           TEXT PRIMARY KEY,
      label        TEXT NOT NULL,
      format       TEXT NOT NULL,
      rating       INTEGER NOT NULL DEFAULT 0,
      active       INTEGER NOT NULL DEFAULT 0,
      last_synced  TEXT,
      sync_month   TEXT
    );
    CREATE TABLE IF NOT EXISTS pokemon_usage (
      reg_id       TEXT NOT NULL,
      month        TEXT NOT NULL,
      name         TEXT NOT NULL,
      usage_pct    REAL NOT NULL,
      raw_count    INTEGER,
      PRIMARY KEY (reg_id, month, name)
    );
    CREATE TABLE IF NOT EXISTS pokemon_meta (
      reg_id         TEXT NOT NULL,
      month          TEXT NOT NULL,
      name           TEXT NOT NULL,
      moves_json     TEXT NOT NULL,
      items_json     TEXT NOT NULL,
      spreads_json   TEXT NOT NULL,
      abilities_json TEXT NOT NULL,
      teammates_json TEXT NOT NULL,
      PRIMARY KEY (reg_id, month, name)
    );
    -- Generic key-value store (used to cache Showdown pokedex.json)
    CREATE TABLE IF NOT EXISTS kv_store (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    -- Showdown types + base stats per Pokemon (populated during sync)
    CREATE TABLE IF NOT EXISTS pokemon_showdown (
      name        TEXT PRIMARY KEY,
      types_json  TEXT NOT NULL,
      stats_json  TEXT NOT NULL,
      sprite_url  TEXT
    );
    CREATE TABLE IF NOT EXISTS move_learners (
      reg_id       TEXT NOT NULL,
      month        TEXT NOT NULL,
      move_name    TEXT NOT NULL,
      pokemon_name TEXT NOT NULL,
      PRIMARY KEY (reg_id, month, move_name, pokemon_name)
    );
    CREATE TABLE IF NOT EXISTS pokemon_abilities (
      reg_id       TEXT NOT NULL,
      month        TEXT NOT NULL,
      pokemon_name TEXT NOT NULL,
      ability_name TEXT NOT NULL,
      pct          REAL NOT NULL,
      PRIMARY KEY (reg_id, month, pokemon_name, ability_name)
    );
    -- Legal moves per Pokémon per regulation (from Smogon dex pages)
    CREATE TABLE IF NOT EXISTS pokemon_learnsets (
      reg_id       TEXT NOT NULL,
      pokemon_name TEXT NOT NULL,
      moves_json   TEXT NOT NULL,
      PRIMARY KEY (reg_id, pokemon_name)
    );
    -- Flat index: move → Pokémon (from learnset data, not just usage data)
    CREATE TABLE IF NOT EXISTS learnset_learners (
      reg_id       TEXT NOT NULL,
      move_norm    TEXT NOT NULL,
      move_display TEXT NOT NULL,
      pokemon_name TEXT NOT NULL,
      PRIMARY KEY (reg_id, move_norm, pokemon_name)
    );
    CREATE INDEX IF NOT EXISTS idx_learnset_learners_reg_move ON learnset_learners(reg_id, move_norm);
    CREATE INDEX IF NOT EXISTS idx_usage_reg_month    ON pokemon_usage(reg_id, month);
    CREATE INDEX IF NOT EXISTS idx_meta_reg_month     ON pokemon_meta(reg_id, month);
    CREATE INDEX IF NOT EXISTS idx_abilities_reg_month ON pokemon_abilities(reg_id, month);

    -- ── Tournament cache (Limitless TCG) ──────────────────────────────────────
    CREATE TABLE IF NOT EXISTS tournaments (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      date       TEXT,
      players    INTEGER NOT NULL DEFAULT 0,
      format     TEXT,
      has_lists  INTEGER NOT NULL DEFAULT 0,
      source     TEXT NOT NULL DEFAULT 'limitless',
      synced_at  TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tournaments_date    ON tournaments(date DESC);
    CREATE INDEX IF NOT EXISTS idx_tournaments_players ON tournaments(players DESC);
    CREATE INDEX IF NOT EXISTS idx_tournaments_format  ON tournaments(format);
    CREATE INDEX IF NOT EXISTS idx_tournaments_source  ON tournaments(source);

    -- Standings stored as a single JSON blob per tournament (on-demand)
    CREATE TABLE IF NOT EXISTS tournament_standings (
      tournament_id TEXT PRIMARY KEY,
      standings_json TEXT NOT NULL,
      synced_at TEXT NOT NULL
    );
  `);

  // ── Migrations for existing DBs ──────────────────────────────────────────────
  // Add `source` column if it was created before RK9 support was added
  try { db.exec("ALTER TABLE tournaments ADD COLUMN source TEXT NOT NULL DEFAULT 'limitless'"); }
  catch (_) { /* column already exists */ }
  try { db.exec("CREATE INDEX IF NOT EXISTS idx_tournaments_source ON tournaments(source)"); }
  catch (_) {}

  return db;
}

// Ensure any pending debounced write is flushed before the process exits.
process.on('exit',    flushToDisk);
process.on('SIGINT',  () => { flushToDisk(); process.exit(0); });
process.on('SIGTERM', () => { flushToDisk(); process.exit(0); });

module.exports = { getDb: getWrappedDb, initSchema, saveToDisk, flushToDisk, wrapDb };
