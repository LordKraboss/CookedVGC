// tournament/store.js
// Persistence layer for the live tournament subsystem. Tables are namespaced
// `tour_*` to avoid colliding with the existing RK9/Limitless `tournaments` cache.
//
// Every function takes an injected `db` (the wrapDb() handle), so the whole layer
// is testable against an in-memory sql.js instance — no file I/O, no singletons.

const _ensured = new WeakSet();

function ensureSchema(db) {
  if (_ensured.has(db)) return db;
  db.exec(`
    CREATE TABLE IF NOT EXISTS tour_events (
      code                 TEXT PRIMARY KEY,
      name                 TEXT NOT NULL,
      reg_id               TEXT,
      format               TEXT NOT NULL,
      config_json          TEXT NOT NULL,
      status               TEXT NOT NULL,          -- lobby|running|complete|destroyed|abandoned
      stage                TEXT,                   -- swiss|round_robin|playoff|null
      current_round        INTEGER NOT NULL DEFAULT 0,
      master_client_id     TEXT NOT NULL,
      master_plays         INTEGER NOT NULL DEFAULT 0,
      bracket_json         TEXT,                   -- playoff bracket structure (engine output)
      final_standings_json TEXT,                   -- frozen on COMPLETE
      created_at           TEXT NOT NULL,
      updated_at           TEXT NOT NULL,          -- bumped on EVERY mutation (stale sweep)
      completed_at         TEXT
    );
    CREATE TABLE IF NOT EXISTS tour_participants (
      code           TEXT NOT NULL,
      client_id      TEXT NOT NULL,
      display_name   TEXT NOT NULL,
      team_json      TEXT,
      team_status    TEXT NOT NULL DEFAULT 'none',  -- none|submitted|rejected
      reject_comment TEXT,
      status         TEXT NOT NULL DEFAULT 'lobby', -- lobby|active|dropped|eliminated
      seed           INTEGER,
      joined_at      TEXT NOT NULL,
      PRIMARY KEY (code, client_id)
    );
    CREATE TABLE IF NOT EXISTS tour_matches (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      code             TEXT NOT NULL,
      bracket_match_id TEXT,                        -- engine id for playoff (W0-0, L1-0, GF, TP)
      stage            TEXT NOT NULL,               -- swiss|round_robin|playoff
      round            INTEGER NOT NULL,
      bracket          TEXT,                        -- W|L|GF|TP|null
      table_no         INTEGER,
      p1_client_id     TEXT,
      p2_client_id     TEXT,                        -- null = bye
      best_of          INTEGER NOT NULL,
      p1_report_json   TEXT,
      p2_report_json   TEXT,
      p1_score         INTEGER,
      p2_score         INTEGER,
      winner_client_id TEXT,
      status           TEXT NOT NULL,               -- pending|reported_partial|disputed|
                                                    --   no_show_pending|validated|walkover|bye
      activated_at     TEXT,
      p1_present_at    TEXT,                        -- player confirmed presence (no-show timer stops)
      p2_present_at    TEXT,
      no_show_by       TEXT,
      next_match_id    TEXT,                        -- engine bracket ref (winner advances)
      loser_next_id    TEXT,                        -- engine bracket ref (loser drops)
      created_at       TEXT NOT NULL,
      updated_at       TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_tour_part_code   ON tour_participants(code);
    CREATE INDEX IF NOT EXISTS idx_tour_match_code  ON tour_matches(code);
    CREATE INDEX IF NOT EXISTS idx_tour_events_stat ON tour_events(status);
  `);
  // Migrations for existing DBs — presence confirmation columns.
  try { db.exec('ALTER TABLE tour_matches ADD COLUMN p1_present_at TEXT'); } catch (_) {}
  try { db.exec('ALTER TABLE tour_matches ADD COLUMN p2_present_at TEXT'); } catch (_) {}
  _ensured.add(db);
  return db;
}

// ── Row access ──────────────────────────────────────────────────────────────────
function getEvent(db, code) {
  return db.prepare('SELECT * FROM tour_events WHERE code = ?').get(code);
}
function getParticipants(db, code) {
  return db.prepare('SELECT * FROM tour_participants WHERE code = ? ORDER BY joined_at ASC').all(code);
}
function getParticipant(db, code, clientId) {
  return db.prepare('SELECT * FROM tour_participants WHERE code = ? AND client_id = ?').get(code, clientId);
}
function getMatches(db, code) {
  return db.prepare('SELECT * FROM tour_matches WHERE code = ? ORDER BY round ASC, table_no ASC, id ASC').all(code);
}
function getMatch(db, code, id) {
  return db.prepare('SELECT * FROM tour_matches WHERE code = ? AND id = ?').get(code, id);
}

function touchEvent(db, code, when) {
  db.prepare('UPDATE tour_events SET updated_at = ? WHERE code = ?').run(when, code);
}

// Delete a tournament's child rows (participants + matches). Event row handled by caller.
function deleteChildren(db, code) {
  db.prepare('DELETE FROM tour_participants WHERE code = ?').run(code);
  db.prepare('DELETE FROM tour_matches WHERE code = ?').run(code);
}

module.exports = {
  ensureSchema,
  getEvent, getParticipants, getParticipant, getMatches, getMatch,
  touchEvent, deleteChildren,
};
