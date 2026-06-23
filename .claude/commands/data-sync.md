We're working on the backend data pipeline (sync, DB, routes). Read CLAUDE.md first.

Key files for this session:
- `backend/src/db/schema.js` — SQLite schema (sql.js), `wrapDb`, `getDb`, `initSchema`
- `backend/src/services/smogonSync.js` — monthly Smogon chaos data sync (usage, meta, moves, items, spreads, teammates)
- `backend/src/services/smogonLearnsets.js` — per-regulation learnset sync from Smogon dex
- `backend/src/services/showdownData.js` — Showdown pokedex/movedex/itemdex/abilitydex (in-memory, loaded on demand)
- `backend/src/services/tournamentSync.js` — Limitless TCG tournament sync (daily)
- `backend/src/services/rk9Sync.js` — RK9 tournament sync (daily)
- `backend/src/services/tournamentScheduler.js` — orchestrates daily sync with catch-up on startup
- `backend/src/services/sprites.js` — local sprite download + cache
- `backend/src/routes/index.js` — all non-tournament REST routes

DB tables (main schema):
- `regulations` — reg id, label, sync_month, last_synced
- `pokemon_usage` — reg_id, month, name, usage_pct, raw_count
- `pokemon_meta` — reg_id, month, name, moves/items/spreads/abilities/teammates JSON
- `pokemon_showdown` — cross-reg dex (types, base stats, sprite_url) from Showdown
- `move_learners` — usage-based (who used this move in battles)
- `learnset_learners` — format-legal learnsets from Smogon dex (preferred over move_learners)
- `tournaments`, `tournament_standings` — RK9/Limitless external tournament cache
- `tour_*` — live tournament tables (see tournament system docs in CLAUDE.md)

Cron schedule (app.js):
- Monthly (2nd at 06:00): `syncAll()` — Smogon + Showdown refresh
- Daily (00:05 UTC): tournament sync (Limitless + RK9) with startup catch-up
- Daily (03:00): `sweepStale()` — abandon idle live tournaments

What needs doing?
