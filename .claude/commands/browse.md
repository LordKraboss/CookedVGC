We're working on the tournament data browsing pages (read-only archive, not the live system). Read CLAUDE.md first.

Key files for this session:
- `frontend/src/pages/TournamentTeams.jsx` — RK9/Limitless external tournament browser
- `frontend/src/pages/TournamentResults.jsx` — our own completed tournaments archive
- `frontend/src/components/tournamentBrowser.jsx` — shared components: FilterBar, TournamentCard, StandingRow, skeletons
- `frontend/src/components/PokemonChip.jsx` — PokemonChip + TeamSheet

These two pages share the same visual layout. Any layout/filter/card change should apply to both unless explicitly scoped to one. TournamentTeams pulls from `/api/tournaments/vgc`, TournamentResults pulls from `/api/tourney/results`.

What needs doing?
