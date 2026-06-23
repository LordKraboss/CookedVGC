We're working on the Team Builder. Read CLAUDE.md first.

Key files for this session:
- `frontend/src/pages/TeamBuilder.jsx` — main page (/teams): team list, slot editor, import/export
- `frontend/src/components/PokemonSlotCard.jsx` — one Pokémon slot (name, item, ability, moves, EVs, nature, tera)
- `frontend/src/components/SpeedOptimizerModal.jsx` — speed EV optimizer
- `frontend/src/components/TypeCoverageModal.jsx` — offensive coverage checker
- `frontend/src/components/AddToTeamButton.jsx` — "add to team" used in MetaAnalysis/MoveLookup
- `frontend/src/hooks/useTeams.js` — ALL team CRUD (localStorage "vgc_teams_v2"); newTeam, updateSlot, deleteTeam, etc.
- `frontend/src/components/AutocompleteInput.jsx` — used for Pokémon/move/item/ability name inputs

Team storage: localStorage key `vgc_teams_v2` → `{ teams: [...] }`. Each team: `{ id, name, reg, slots: [slot|null, ...6] }`. Each slot: `{ name, types, spriteUrl, nature, evs:{hp,atk,def,spa,spd,spe}, moves:[], item, ability, teraType }`.

Import/export: Showdown paste format. Parser + serializer live in TeamBuilder.jsx.

Backend calls used (all autocomplete, no team storage server-side):
- `getPokemonSuggestions(q, reg)` → `/pokemon/suggest`
- `getMoveSuggestions(q, reg, pokemon)` → `/moves/suggest`
- `getAbilitySuggestions(q, reg)` → `/abilities/suggest`
- `getItemSuggestions(q, reg)` → `/items/suggest`
- `getPokemonMeta(name, reg)` → `/pokemon/:name/meta` (to pre-fill moves/items/spreads)
- `getPokemonLearnset(name, reg)` → `/pokemon/:name/learnset` (legal move validation)

What needs doing?
