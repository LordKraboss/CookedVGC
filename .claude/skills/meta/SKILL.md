We're working on the meta/usage data pages. Read CLAUDE.md first.

Key files for this session:
- `frontend/src/pages/MetaAnalysis.jsx` — home page (/), usage grid, Pokémon detail drawer
- `frontend/src/pages/MoveLookup.jsx` — move search + who learns it
- `frontend/src/components/PokemonCard.jsx` — full card (types, stats, moves, items, spreads, teammates)
- `frontend/src/components/AutocompleteInput.jsx` — shared autocomplete with debounce
- `frontend/src/components/MovePool.jsx` — move list panel
- `backend/src/routes/index.js` — all data routes (usage, pokemon/meta, moves, abilities, items, by-filter, by-moves, team/suggest)

Backend data flow:
- Usage + meta come from Smogon chaos data (`smogonSync.js`), synced monthly
- Learnsets come from Smogon dex (`smogonLearnsets.js`), synced per-regulation
- Showdown pokedex (types, base stats, abilities) loaded in memory from `showdownData.js`
- Sprites served from `/sprites/` static dir (local cache, `services/sprites.js`)
- All data is regulation-scoped via `?reg=REG-H` query param → `resolveReg(req.query)`

Key routes (all under /api):
- GET `/usage?reg=` — full usage list for MetaAnalysis grid
- GET `/pokemon/:name/meta?reg=` — detailed stats for one Pokémon
- GET `/pokemon/:name/learnset?reg=` — format-legal moveset
- GET `/pokemon/by-moves?moves=a,b&reg=` — intersection filter
- GET `/pokemon/by-filter?types=fire,water&ability=X&reg=` — type/ability filter
- GET `/moves/:move/learners?reg=` — who uses this move
- POST `/team/suggest` `{ team: [names], reg }` — teammate recommendations

What needs doing?
