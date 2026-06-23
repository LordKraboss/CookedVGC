# CLAUDE.md — VGCtool

## Mission

VGCtool is a production-grade VGC web app for competitive players.
Optimize for fast team-building, matchup prep, tournament browsing, and metagame analysis rather than generic marketing-site output.

Act as a senior product engineer, UX designer, and competitive VGC analyst.
Think like both a tournament player and a web app architect.

## Claude Code operating rules

- Read relevant files before making claims about the codebase or editing anything. Never speculate about files you have not opened.
- Prefer direct execution-oriented behavior: inspect, plan briefly, edit, run checks, then report what changed.
- Default to the simplest robust solution for the current scope.
- Do not overengineer MVP work.
- When the request is ambiguous, ask a focused question before changing architecture, database shape, or shared patterns.
- Preserve existing project conventions unless there is a clear reason to change them.
- Show evidence when asserting something works: test output, command output, or a precise explanation of what was verified.
- After meaningful structural changes, update this file with permanent facts only.

## Execution workflow

For implementation tasks, follow this default loop:
1. Read the relevant files.
2. State the plan briefly.
3. Make the smallest coherent set of edits.
4. Run the narrowest useful validation.
5. Report changed files, what changed, and what was verified.

For larger tasks, break work into small validated steps rather than one large rewrite.

## Edit boundaries

Do not change these without explicit approval:
- Core tournament lifecycle semantics
- Scoped visibility/privacy rules for teamsheets and opponent data
- `clientId` identity behavior
- Database schema patterns with cross-feature consequences
- Global conventions used by multiple pages
- Destructive cleanup outside the immediate task

Prefer additive or local edits over broad refactors unless the user explicitly asks for a refactor.

## Maintenance rule

At the end of every session, before closing, update this file with structural changes only:
- New files created → add to the file map
- New routes added → add to the route table
- New status values, lifecycle changes, or invariants → update the relevant section
- New shared components or changed props → update the shared components section
- New conventions established → add to the conventions section

Keep entries concise. Do not write narrative changelogs here.
If nothing structural changed, do not update the file.

## Dev setup

| What | Command | Port |
|---|---|---|
| Backend | `cd backend && node src/app.js` | 3001 |
| Frontend | `cd frontend && npm run dev -- --port 5174 --strictPort` | 5174 |
| Backend tests | `cd backend && node --test src/tournament/match.test.js` | — |

API base: `http://localhost:3001/api`
CORS allows: 5173 (ambulance-app) and 5174 (this app)

## What to run

Use the narrowest command that proves the change:
- Backend logic change → run the relevant backend test file first
- Route/service change → run targeted backend tests, then boot backend if needed
- Frontend UI change → run frontend dev server if needed and inspect impacted files carefully
- Cross-cutting change → run both the relevant backend test(s) and frontend checks appropriate to scope

If you could not run validation, say so explicitly.

## Product focus

This is a VGC web app, not a generic SaaS product.
Prioritize features that are genuinely useful for competitive players:
- Metagame dashboards
- Usage statistics by format, regulation, event, and time range
- Team builder and team management flows
- Team archetype discovery
- Common lead pairings and core combinations
- Matchup and threat analysis
- Rental team directory
- Tournament browser and tournament result summaries
- Quick search, filtering, and comparison workflows
- Mobile-friendly event prep

Use real player jobs as the product lens:
- I need a team fast
- I want to prep for a matchup
- I want to see what won recent events
- I want to compare trends across regulations

## Domain guardrails

- Treat VGC as a regulation-driven doubles format.
- Optimize for competitive players, not casual Pokédex browsing.
- Never invent tournament results, usage stats, legality, or metagame conclusions.
- Distinguish hard data from interpretation.
- Flag sparse samples and uncertain conclusions.
- Preserve competitive integrity and scoped information access.

## Frontend file map

```text
src/
  App.jsx                         — router, sidebar nav (desktop rail / mobile hamburger drawer via useIsMobile), RegulationProvider/ThemeProvider wrappers
  lib/
    api.js                        — ALL fetch calls; never fetch() directly in components
    clientId.js                   — stable per-browser identity (localStorage "vgc_client_id")
    gameSocket.js                 — singleton Socket.IO client
    RegulationContext.jsx         — active regulation, list of regs
    ThemeContext.jsx              — dark/light theme
    CalculatorContext.jsx         — damage calculator state
    typeChart.js                  — shared Gen-9 type chart: TYPE_CHART, effectiveness(), getTypeMatchups(), multLabel()
  hooks/
    useTeams.js                   — CRUD for saved teams (localStorage "vgc_teams_v2")
    useMediaQuery.js              — reactive matchMedia hook; exports useMediaQuery(), MOBILE_QUERY (max-width:768px), useIsMobile()
  pages/
    MetaAnalysis.jsx              — usage stats / meta overview (home page at /)
    MoveLookup.jsx                — move search + learners
    TeamBuilder.jsx               — full team editor
    TournamentTeams.jsx           — RK9/Limitless tournament teams browser
    TournamentResults.jsx         — completed tournaments archive (/tools/tournament-results)
    Tournament.jsx                — live tournament system (/tools/tournament)
    Calculator.jsx                — damage calc; per-side bpOverrides + makeCalcMove() apply manual BP for counter moves (Last Respects, Rage Fist)
    SpeedTier.jsx, Draft.jsx      — standalone tools
    AccuracyCheck.jsx             — hit-chance tool (/tools/accuracy): move acc × stage × item/ability modifiers + multi-hit (stop-on-miss) & repeated-use (binomial) hit-count distributions
    ItemDex.jsx                   — legal-item catalogue tool (/tools/items): searchable list + tri-state category filters
  components/
    tournamentBrowser.jsx         — shared: FilterBar, TournamentCard, StandingRow, skeletons
    PokemonChip.jsx               — shared: PokemonChip, TeamSheet
    PokemonCard.jsx               — full card used in TeamBuilder/MetaAnalysis
    AutocompleteInput.jsx         — name autocomplete with debounce
  game/
    useGameRoom.js                — transport abstraction: 'local' (pass-and-play) or 'room' (networked)
    DraftBoard.jsx                — board UI for Draft mode
    AuctionBoard.jsx              — board UI for Auction mode (selection → bidding → done)
    modes/
      index.js                    — mode registry (draft, auction)
      draft.js                    — draft mode: init(), reducer(), meta
      auction.js                  — auction mode: init(), reducer(), meta (fully implemented)
scripts/
  refresh-calc.mjs                — CLI: rebuild @smogon/calc from damage-calc master, regen patch (run: npm run refresh-calc)
patches/
  @smogon+calc+0.11.0.patch       — committed calc patch (mechanics+dex from master); reapplied by postinstall
```

## Backend file map

```text
src/
  app.js                          — Express app, cron jobs, Socket.IO init
  db/schema.js                    — sql.js DB singleton (wrapDb, getDb, initSchema)
  routes/
    index.js                      — mounts routers under /api
    tournaments.js                — /api/tourney/* REST surface for live tournaments
  tournament/
    service.js                    — tournament business logic (db-injected, unit-testable)
    store.js                      — raw DB queries
    engine.js                     — pure pairings/standings algorithms
    realtime.js                   — broadcastTournament(), attachTournamentRealtime()
    match.test.js                 — integration tests
    service.test.js, engine.test.js
  realtime/roomServer.js          — Socket.IO game rooms (Draft mode)
  services/
    smogonSync.js, showdownData.js — Smogon/Showdown data sync
    championsData.js               — Champions mod data from Showdown GitHub (learnsets, formats-data, item legality/descriptions/categories, move overrides)
    smogonLearnsets.js             — learnset sync from Champions mod; also populates pokemon_showdown + downloads sprites
    tournamentSync.js, rk9Sync.js  — RK9/Limitless sync
    tournamentScheduler.js         — daily sync orchestration
    sprites.js                     — local sprite cache
  scripts/
    refreshChampions.js            — CLI: refresh base pokedex (refreshPokedex) + Champions mod cache + re-sync learnsets for all regs
                                     (run: npm run refresh-champions)
```

## Tournament system architecture

### REST routes (`/api/tourney`)

| Method | Path | Action |
|---|---|---|
| POST | `/` | createTournament |
| GET | `/:code` | getStateFor (scoped by `?clientId`) |
| POST | `/:code/join` | joinTournament |
| POST | `/:code/team` | submitTeam |
| POST | `/:code/team/reject` | rejectTeam |
| POST | `/:code/launch` | launch |
| POST | `/:code/advance` | advance round |
| POST | `/:code/matches/:id/report` | reportScore |
| POST | `/:code/matches/:id/no-show` | reportNoShow |
| POST | `/:code/matches/:id/resolve` | resolveMatch |
| POST | `/:code/participants/:cid/drop` | dropParticipant |
| POST | `/:code/complete` | completeTournament |
| POST | `/:code/close` | closeTournament |
| POST | `/:code/destroy` | destroyTournament |
| GET | `/results` | listResults (queries `status IN ('complete','closed')`) |
| GET | `/results/:code` | getResultDetail (accepts `complete` and `closed`) |

### Socket.IO rule

Push only `tournament:changed` with `{ code }`, then refetch scoped REST state.
Never push full tournament state over the socket because teamsheet visibility must remain scoped.

```js
socket.emit('tourney:subscribe', { code })
socket.on('tournament:changed', () => refetch)
```

### Status lifecycle

```text
lobby → running → complete → closed
                           → destroyed
lobby/running/complete → abandoned
```

- `closed` = result kept in archive
- `destroyed` = result deleted
- `abandoned` = stale sweep for old lobby/running/complete tournaments

### Stage lifecycle

```text
round_robin: pre-generates all rounds at launch; activate round-by-round via advance()
swiss: generates one round at a time; advance() creates the next
swiss_playoff: swiss rounds then playoff from standings
playoff: full bracket at launch; slots fill as matches resolve
```

### Key invariant — `activated_at`

Only a match with `activated_at != null` is live.
Future dormant matches must not be treated as active by frontend or backend logic.

```js
const myMatch = st.matches.find(m =>
  m.youAreIn && m.activatedAt && !['validated', 'walkover', 'bye'].includes(m.status)
)
```

Backend must reject `reportScore` when `!m.activated_at`.

### Identity and scoped state

`clientId` is a UUID from `localStorage` (`vgc_client_id`) and is the stable player identity.
`joinTournament` is idempotent for an existing `clientId`.

`getStateFor(db, code, requesterClientId)` returns scoped state:
- `you.isMaster`
- `you.isParticipant`
- `opponentTeam` only when teamsheet is open and match is activated
- `myReport` for the requester
- `team` visible only to the player or the organizer-reviewer when allowed

### Standings

VGC tiebreakers (in order):
1. Match points
2. Opponent win% (résistance), each opponent floored at 25%, head-to-head matches vs the player excluded (spec-exact)
3. Opponent-opponent win%
4. Head-to-head (pairwise; cyclic ties fall through)
5. Game differential (`gameWins - gameLosses`)

Byes count as wins for match points but are excluded from opponent lists (no résistance pollution).
Implemented in `engine.computeStandings()` via a directed `h2h` map; `winPctExcluding(opp, vs)` drives the spec-exact OWP.
Playoff order uses `finalPlayoffStandings()` (placement-based, not résistance).

## Shared frontend components

### `tournamentBrowser.jsx`

```js
FilterBar        // props: filters, setFilters, formats, showSource=true, infoRight=null, regLabel='REGULATION'
TournamentCard   // props: tournament {id,name,date,players,format,hasLists,source}, selected, onClick
StandingRow      // props: entry {placing,name,record,team}, onImport optional
SkeletonCard, SkeletonStanding
formatDate, sinceFromPreset, timeAgo, placingLabel, formatRecord
```

### `PokemonChip.jsx`

```js
PokemonChip   // props: pokemon, expanded, onToggle
TeamSheet     // props: team, defaultExpanded=false
```

## Coding conventions

- `src/lib/api.js` is the only place allowed to perform fetch calls.
- Do not add comments unless the why is non-obvious.
- Do not add abstraction beyond the immediate task.
- Do not keep backwards-compat shims; remove dead code outright.
- Tournament/results pages use inline styles only, with CSS vars:
  `var(--bg1/bg2/bg3)`, `var(--border)`, `var(--accent)`, `var(--text-primary/secondary/muted)`, `var(--mono)`
- Mobile responsiveness (breakpoint 768px): `useIsMobile()` for JS branching (e.g. `App.jsx` Layout → desktop sidebar vs `MobileLayout` hamburger drawer). For inline-styled grids/rows, pair a utility class in `index.css` (under one `@media (max-width:768px)` block) with the inline desktop style; use `!important` to beat inline. Existing utilities: `stack-mobile` (grid→1col), `flex-col-mobile` (two-pane→stacked), `calc-move-name`, `pkrow-id`/`pkrow-stats` + `.pokemon-row` (hide stats/usage bar), `spd-*` (SpeedOptimizerModal), `ev-grid`/`ev-slider` (hide TeamBuilder EV sliders). Never leave horizontal scroll on mobile.
- `act(fn)` pattern in `Room`: set `busy`, call `fn()`, refresh, catch into `err` state.
- `mut()` wrapper in routes: call service fn, send response, then broadcast `tournament:changed`.
- Tests use in-memory sql.js DB via `mkDb()`; avoid mocks for tournament logic.
- Game modes: each mode exports `{ meta, init(config, source), reducer(state, action) }` — pure, no React.
- Game timer model: store `{ startedAt: Date.now() }` in state; clients compute remaining locally; HOST dispatches `*Timeout` actions via `setTimeout` in the board component.
- `Draft.jsx` routes to `DraftBoard` or `AuctionBoard` based on `session.modeId`; `roomServer.js` is mode-agnostic and never needs changes for new modes.

### @smogon/calc patching (frontend)

- npm `@smogon/calc@0.11.0` is the latest release but lags damage-calc `master`; the Showdown calc website runs from master. Custom-ability *mechanics* (e.g. Fire Mane's ×1.5 on Fire moves) live in compiled calc code, NOT in our runtime dex refresh — they only update by rebuilding the calc from source.
- `npm run refresh-calc` clones master, compiles the `calc` subpackage, overlays `dist/` onto node_modules, and regenerates `patches/@smogon+calc+0.11.0.patch` (runtime `.js` + dex only; maps/d.ts/tests excluded). Run it to pull the latest master (e.g. alongside `refresh-champions`), then commit the patch.
- `postinstall: patch-package` reapplies the committed patch on every install.
- **Deployment/CI:** the refresh step needs git + network to clone master, but only when you choose to refresh — normal installs/builds just apply the committed patch (no git/network/build of calc needed).
- After refreshing, restart Vite with `--force` (or delete `node_modules/.vite`) to clear the dep pre-bundle cache.
- Counter-based moves (Last Respects, Rage Fist) keep a flat `bp` in calc data; `Calculator.jsx` lets the user set BP via per-side `bpOverrides`. Always build moves through `makeCalcMove(atkSide, name)` (not `new CalcMove`) so `runCalc` and both optimizers sweep the overridden BP.

## Preferred response shape in Claude Code

For code tasks, answer with:
1. Brief plan
2. Changes made
3. Validation run
4. Any assumptions or follow-ups

For non-edit analysis tasks, answer with:
1. Findings grounded in files read
2. Recommendation
3. Smallest safe next step

Keep answers concise and implementation-oriented.

## Champions regulation data pipeline

### How a new regulation gets its data

1. Add the reg to `shared/regulations.js` with `dexGen: "champions"` and `startMonth`.
2. On next server startup, `syncAll` Phase 1 attempts Smogon chaos sync (fails gracefully if no stats yet).
3. `syncAll` Phase 2 calls `syncLearnsets` with `getLearnsetPokemonList(reg)`, which for `dexGen: "champions"` regs returns `getLegalChampionsPokemon()` (the mod legal list) regardless of chaos — the mod is the authoritative roster. Non-champions regs use their chaos usage names. `syncLearnsets` also populates `pokemon_showdown` (types/stats) and downloads sprites.
4. After Phase 2: `learnset_learners`, `pokemon_learnsets`, `pokemon_showdown`, and sprite files are all populated.
5. When Smogon publishes chaos stats, the next `syncAll` Phase 1 fills in usage/meta data only. Chaos never expands the legal roster — `learnset_learners`/`pokemon_learnsets` stay mod-defined; chaos only enriches usage stats and usage-derived breakdowns.

`getLegalChampionsPokemon()` legality rule: legal when `isNonstandard == null` (also excludes explicit `tier === "Illegal"`). A tier-only filter leaks Past/Future formes (typed Arceus, battle-only formes) that omit `tier`; megas stay legal because Champions gives them a real tier and clears `isNonstandard`. Mirrors the item-legality rule.

`getChampionsLearnset` walks Mega/forme → baseSpecies → prevo over the Champions mod learnsets; if that chain is empty, it tries the base species' other formes that DO have a mod learnset (Floette-Mega's legal pre-mega is Floette-Eternal, per Floettite's megaStone map, which holds Light of Ruin); only if that is also empty does it fall back to the full Showdown learnset walk. Mod entries stay authoritative — fallbacks only fire on zero mod coverage. `getPokemonGen9Moves` (no-month route fallback) walks baseSpecies then prevo for the same reason.

```bash
cd backend && npm run refresh-champions
```

Clears Champions mod cache, re-fetches from GitHub, re-syncs learnsets, repopulates `pokemon_showdown`, downloads new sprites.

### Routes when a regulation has no chaos data (no `sync_month`)

- `GET /usage?reg=X` — `learnset_learners`-scoped roster on BOTH paths: no-month returns it at 0% usage; month (chaos) path also scopes to `learnset_learners` (not all of `pokemon_showdown`) so the global `pokemon_showdown` union can't leak illegal formes. Unscoped fallback only when learnset sync hasn't run yet.
- `GET /pokemon/:name/meta?reg=X` — returns basic data (types/stats/sprite/abilities) from `pokemon_showdown` + `loadPokedex()`, no move/item stats. Both chaos and no-chaos paths return `allAbilities` (`[string]`, display-cased full legal set from `loadPokedex()`); `abilities` is usage-ordered (chaos) or the full set (no-chaos). The Calculator ability field is a `<select>` driven by `meta.allAbilities` — `@smogon/calc` species data only carries ability slot 0, so it can't be used for the legal list.
- `GET /pokemon/by-moves?reg=X` — uses `learnset_learners` if available (fast); falls back to Gen9 learnsets otherwise. Response contract: `abilities` is always `[{name}]` objects (frontend `PokemonRow` reads `a.name`); `allAbilities` is `[string]` — keep both shapes consistent across the month and no-month paths.
- `GET /moves/suggest?reg=X&pokemon=Y` — stored Champions learnset (`getStoredLearnset`) is authoritative for move legality regardless of chaos data; falls back to Gen9 legal moves only when no learnset is synced
- `GET /items/suggest?reg=X` — for `dexGen: "champions"` regs, suggests from the Champions legal item pool (`getLegalChampionsItems()`), ordered by chaos usage % when a month exists, else alphabetical. Non-champions regs keep the global Showdown item-dex fallback.
- `GET /items/legal?reg=X` — full legal item catalogue with descriptions + category flags. Champions regs use the legal pool, others the full Showdown item dex. Returns `{ reg, hasUsage, count, flags:[present categories], items:[{id,name,desc,flags,usagePct}] }`, sorted by usage % then name. Powers ItemDex.
- `pokemon_showdown` is a global table (no `reg_id`); regulation scoping uses `learnset_learners WHERE reg_id=?`

### Champions item legality (`championsData.getLegalChampionsItems()`)

Champions is a restricted-item format (~147 of 583 items legal: all mega stones re-enabled, many standard items like Assault Vest/Choice Band banned). Effective legality = Champions `items.ts` override (`isNonstandard`) when present, else base `items.ts`; legal when `isNonstandard === null`. Both files are line-parsed (not `vm`-parsed — `items.ts` has method bodies with TS casts) and cached to disk (`base-items.json`, `champions-items.json`), cleared by `refreshChampionsMod()`.

`loadItemDescriptions()` (cache `item-texts`) parses `data/text/items.ts` via `parseTsObject` (pure-data) → `{id:{name,shortDesc,desc}}`. `loadItemCategories()` (cache `item-categories`) line-parses base `items.ts` category fields (megaStone/isBerry/isGem/zMove/onPlate/isPokeball/isChoice/isPrimalOrb) → `{id:[flags]}`. Both global (legality-independent), cleared by `refreshChampionsMod()`; consumed by `/items/legal`.

### Champions move overrides (`championsData.getChampionsMoveDex()`)

Champions `moves.ts` overrides basePower/type/accuracy/pp/category/isNonstandard on ~259 moves. `getChampionsMoveDex()` returns the full base Showdown move dex with these overrides merged in (memoised). The override file is line-parsed for whitelisted scalar fields only (method bodies skipped), cached to disk (`champions-moves.json`), cleared by `refreshChampionsMod()`. For `dexGen: "champions"` regs, `/moves/details`, `/moves/types`, and `/pokemon/:name/meta` move enrichment use this merged dex. `/moves/details` and `/moves/types` resolve the reg via `resolveReg` (active reg when no `?reg=` param), so the frontend's no-reg `getMoveDetails`/`getMoveTypes` calls get Champions data automatically.

### Singleton-promise guards in `showdownData.js`

`loadPokedex()` and `loadLearnsets()` use in-flight promise deduplication (`_pokedexFetching`, `_learnsetsFetching`). Prevents N concurrent callers from all issuing separate HTTP requests on cold cache.

## Design and UX rules

- Build for a dense, readable web app, not a marketing page.
- Prefer left-aligned content, strong hierarchy, filters, segmented controls, stat cards, tables, and trend views.
- Avoid decorative blobs, vague hero copy, repetitive 3-card sections, and generic AI-looking layouts.
- Design for quick scanning of stats, cores, spreads, movesets, items, tera types, and matchup information.
- Mobile support matters because users may check pages during events.
