# Tournament System — Design Doc

Status: **DRAFT for approval** · No code until signed off.
Lives under the **Games** submenu, next to Game Room.

---

## 0. Decisions (all LOCKED)

- **A1 — BO3 score format.** Players report the **game score** (e.g. `2–1`, `2–0`).
  Auto-validates when both players' submitted scores match.
- **A2 — Swiss+Playoff bracket type.** The playoff stage of **Swiss + Playoff is
  single-elimination only**. Double-elimination is offered **only** for the standalone
  **Playoff** format.
- **A3 — Double-elim grand final.** **Single grand final, NO bracket reset.** Exactly one
  set: WB winner vs LB winner, winner takes the title.
- **A4 — 3rd-place match.** **Single-elimination only** (the two semifinal losers play off).
  Double-elim has none (losers-bracket final loser is 3rd).
- **A5 — Round Robin + Playoff.** **Not included.** The four formats are Round Robin, Swiss,
  Playoff, Swiss+Playoff.
- **A6 — Swiss round count.** Organizer sets it freely (≥1); UI **suggests** `ceil(log2(N))`.

---

## 1. Architecture decision (locked)

Tournaments are **server-authoritative and persisted in the sql.js DB**. Unlike the
Game Room (ephemeral, host's browser runs the logic, server just relays), a tournament:

- survives the master closing their laptop, a PM2 reload, or a VPS reboot;
- is destroyed **only** at completion or when the master clicks **Destroy tournament**.

So this is a **new subsystem**, not the relay-with-rules. We reuse the cheap parts:
- `lib/clientId.js` — stable per-browser identity → seat/participant reclamation.
- The lobby + Socket.IO patterns (live push of room state).
- The `TournamentTeams` Pokémon card UI — for open teamsheets and the master's team review.

Transport: **REST for mutations** (create, join, submit team, report, launch, resolve,
destroy — each writes to the DB) **+ Socket.IO for live updates** (clients subscribe to a
tournament code; server emits `tournament:update` on any change). nginx already proxies WS.

---

## 2. Formats & configuration

| Format            | Stage(s)            | Organizer inputs                                            |
|-------------------|---------------------|------------------------------------------------------------|
| **Round Robin**   | round_robin         | Best-of                                                    |
| **Swiss**         | swiss               | # rounds, Best-of                                          |
| **Playoff**       | playoff             | Cut size (power of 2), Best-of, single/double elim, 3rd-place (single only) |
| **Swiss + Playoff** | swiss → playoff   | Swiss: # rounds + Best-of · Playoff: cut size + Best-of (single elim) + 3rd-place |

Shared inputs for **all** formats:
- **Name** (required — every event is archived under it, see §11)
- **Regulation/format** (the team-legality tag; from `shared/regulations`)
- **Players**: no cap
- **Teamsheet**: `open` | `closed` (closed stays hidden the entire event)
- **Organizer plays?**: yes/no (if no, he gets the team-review panel)
- **No-show timer**: `noShowMinutes`, default **10** (per-tournament; after this, the
  present player may report an absent opponent — see §6a)

Server-wide constant (not per-tournament): **`STALE_DAYS = 7`** — inactive lobby/running
tournaments are swept after this (see §10a).

**Validation at creation**
- `playoffSize` must be a power of 2 (2, 4, 8, 16, …) and ≤ expected participants.
- `swissRounds` ≥ 1 (warn if ≥ N, i.e. more rounds than a round robin would need).
- Round Robin / Swiss have no cut size; Playoff has no round count.

---

## 3. Lifecycle

```
LOBBY ──(master launches)──► RUNNING ──(final validated)──► COMPLETE
  │                              │
  └──────── Destroy ◄────────────┴───────── Destroy ──────────► DESTROYED
```

### 3a. Preparation (LOBBY)
1. Join by **code** (or create). Identity = `clientId`; `{code, clientId}` saved in
   localStorage so a refresh/return drops you back into your spot.
2. Each participant picks one of **their locally-stored teams tagged for the tournament's
   regulation**, then clicks **Validate** → status `submitted` (= "Ready"). No legality
   checking beyond the reg tag — that's the organizer's job.
3. **Master review** (only when organizer is *not* playing): sees every submitted team with
   **full info incl. EVs**, and can **Reject** a submission **with a comment**. Rejected →
   player resubmits.
4. **Master clicks Launch** whenever ready. Everyone in `submitted` (and not `rejected`) is
   entered as `active`; everyone else is dropped from the event. Field is locked.

### 3b. Running
- Server generates the current round's pairings, creates `match` rows, pushes update.
- Each player sees their match (§5). They battle **off-site** (Showdown/cartridge) and
  return to **report the score**.
- Score reconciliation (§6) → match validated → standings recompute.
- When all matches in a round are validated, master (or auto) advances to the next round /
  generates the playoff.

### 3c. Complete / Destroy
- Final match validated → `COMPLETE`, final standings + bracket frozen, snapshot written
  for the archive (§11). Completed events **persist permanently** and are never swept.
- **Destroy tournament** (master only) → `DESTROYED`, live row(s) removed. (A completed
  event's archive entry is independent and survives.)
- **Auto-sweep**: a lobby/running tournament with no activity for `STALE_DAYS` is
  abandoned and pruned (§10a). Completed events are exempt.

---

## 4. Pairing & standings engine (pure, unit-tested)

Isolated module, no I/O — this is the bug-prone core, so it's tested independently.

### Round Robin
- Circle method. Rounds = `N−1` (even) or `N` (odd, one **bye** per round).
- A **bye = free match win** (counts for match points; the bye is **not** counted as an
  opponent for resistance).
- Standings only, no playoff.

### Swiss (VGC pairing)
- Sort by current standings; pair top-down **within score groups**, **avoiding rematches**;
  if a group is odd, float a player to the adjacent group.
- One player per round may get a **bye** = the lowest-standing player who hasn't had one;
  bye = free win.
- `swissRounds` rounds total.

### Standings & tiebreakers (Play! Pokémon VGC standard)
1. **Match points** — 3 per win, 0 per loss (byes count as wins).
2. **Opponents' Match-Win %** (resistance) — average of each opponent's win%, **each floored
   at 25% (0.25)**, byes excluded as opponents.
3. **Opponents' Opponents' Match-Win %** — same flooring.
*(Exact formula lives in one module so it's easy to tweak if you want game-win% added.)*

### Playoff seeding
- **Direct Playoff**: random seeding into the bracket.
- **After Swiss**: top `playoffSize` advance, seeded by standings → **1 vs last, 2 vs
  2nd-last, …** (your spec).
- **Single elim**: standard bracket; optional **3rd-place** match (semifinal losers).
- **Double elim** (Playoff format only): winners + losers brackets; **grand final = WB
  winner vs LB winner, single set, no reset** (A3).

### Match result resolution
- BO1: first to 1 game. BO3: first to 2 games.
- Match `validated` once a reconciled score has a player at the win threshold.

---

## 5. Match view

- **Open teamsheet** → opponent's full team rendered with the `TournamentTeams` card
  (Pokémon, item, ability, moves, Tera, EVs/Nature) — same component as the Tournaments page.
- **Closed teamsheet** → only the **opponent's name** (and table #). Stays hidden all event.

## 6. Score reporting & disputes

- Both players submit their result (game score per A1).
- **Match** → `validated` automatically.
- **Mismatch** → `disputed`; the **master is notified**, reviews, **sets the correct score**,
  and validates (override).
- One-sided (only one reported) → `reported_partial`, waits for the other (master can force).

### 6a. No-show reporting

- Each match stores `activated_at` (set when its round opens). The opponent of a present
  player can be reported as a no-show once `now ≥ activated_at + noShowMinutes` (default 10).
- A no-show report does **not** auto-resolve. It flags the match `no_show_pending` and
  **notifies the Tournament Organizer**, who confirms the **walkover** (awards the match to
  the present player) or dismisses it. *(Decision: TO-confirms-first — no self-service
  auto-forfeit.)*
- Scope: a confirmed no-show **forfeits the current match only** — the absent player stays
  in the event and can play later rounds. Walkover score = present player at the win
  threshold, opponent 0 (`1–0` BO1 / `2–0` BO3), match status `walkover`.
- Separately, the **master can manually drop** any participant at any time; a dropped player
  forfeits all remaining matches and is excluded from future pairings.

---

## 7. Data model (sql.js)

```
tournaments
  code            TEXT PK            -- join code (e.g. 4–6 chars)
  name            TEXT
  reg_id          TEXT               -- regulation/format tag
  format          TEXT               -- round_robin | swiss | playoff | swiss_playoff
  config_json     TEXT               -- bestOf(s), swissRounds, playoffSize, playoffType,
                                     --   thirdPlace, teamsheet, organizerPlays
  status          TEXT               -- lobby | running | complete | destroyed | abandoned
  stage           TEXT               -- swiss | playoff | round_robin | null
  current_round   INTEGER
  master_client_id TEXT
  final_standings_json TEXT           -- frozen snapshot written on COMPLETE (archive)
  created_at      TEXT
  updated_at      TEXT               -- bumped on EVERY mutation → drives the stale sweep
  completed_at    TEXT

participants
  tournament_code TEXT
  client_id       TEXT
  display_name    TEXT
  team_json       TEXT               -- submitted team (with EVs)
  team_status     TEXT               -- none | submitted | rejected
  reject_comment  TEXT
  status          TEXT               -- lobby | active | dropped | eliminated
  seed            INTEGER            -- playoff seed (nullable)
  PRIMARY KEY (tournament_code, client_id)

matches
  id              INTEGER PK
  tournament_code TEXT
  stage           TEXT               -- swiss | round_robin | playoff
  round           INTEGER
  bracket         TEXT               -- winners | losers | grand_final | third | null
  table_no        INTEGER
  p1_client_id    TEXT
  p2_client_id    TEXT               -- null = bye
  best_of         INTEGER
  p1_report_json  TEXT               -- {p1Games, p2Games} as p1 sees it
  p2_report_json  TEXT
  p1_score        INTEGER            -- validated game wins
  p2_score        INTEGER
  winner_client_id TEXT
  status          TEXT               -- pending | reported_partial | disputed |
                                     --   no_show_pending | validated | walkover | bye
  activated_at    TEXT               -- set when the round opens → no-show timer base
  no_show_by      TEXT               -- client_id who reported the no-show (pending TO review)
  next_match_id   INTEGER            -- winner advances here (bracket)
  loser_next_id   INTEGER            -- double-elim drop / 3rd-place feed
```

Standings are **computed on the fly** from validated `matches` (always correct, no cache to
desync).

---

## 8. API surface (sketch)

```
POST   /api/tournaments                      create → {code}
POST   /api/tournaments/:code/join           {clientId, name}
GET    /api/tournaments/:code                full state (scoped per requesting clientId)
GET    /api/tournaments/:code/me?clientId    reconnect → my participant + match
POST   /api/tournaments/:code/team           {clientId, teamId/team}  submit/validate
POST   /api/tournaments/:code/team/reject    master: {clientId, comment}
POST   /api/tournaments/:code/launch         master
POST   /api/tournaments/:code/matches/:id/report    {clientId, p1Games, p2Games}
POST   /api/tournaments/:code/matches/:id/no-show    {clientId}  report opponent absent
POST   /api/tournaments/:code/matches/:id/resolve    master: set score / confirm walkover / dismiss
POST   /api/tournaments/:code/participants/:cid/drop master: drop a player
POST   /api/tournaments/:code/advance         master: next round / build playoff
POST   /api/tournaments/:code/destroy         master
GET    /api/tournaments/results               archive list (status=complete)
GET    /api/tournaments/results/:code         one archived event (standings + all sets)
```
Socket: `subscribe(code)` → server emits `tournament:update` (full or diff) on every change.

---

## 10a. Stale-tournament sweep

- Daily `node-cron` job (same mechanism as the monthly Smogon sync).
- Selects tournaments where `status IN ('lobby','running')` and
  `updated_at < now − STALE_DAYS` → set `status='abandoned'` and prune their
  participants/matches rows.
- `updated_at` is bumped on **every** mutation (join, team submit, report, resolve, advance,
  etc.), so any real activity resets the clock.
- **Completed events are never touched** — they're the permanent archive.

## 11. Results archive (new "Results" view under Games)

- Completed tournaments + their participants + all match/set rows **persist permanently** in
  the same tables (no duplication). On COMPLETE we also freeze `final_standings_json` and
  `completed_at` for fast listing.
- New **Results** page under Games lists finished events by name/date/format, and a detail
  view shows final standings, the full bracket, and **every set** (per-match game scores).
- Kept **separate** from the RK9 pro-tournament database (TournamentTeams page) — our own
  events live in their own Results view. (Decision.)

## 9. Frontend (under Games)

- **Create** page: format picker + dynamic config form (mirrors the Game Room lobby's feel).
- **Tournament room**, status-driven:
  - *Lobby*: participants list w/ ready state, team picker (filtered to reg-tagged teams),
    Validate; master controls (Launch, Destroy, team-review panel w/ reject+comment).
  - *Running*: my current match (open/closed sheet), report score, **report no-show** (after
    the timer); standings table; bracket view; round/advance controls for master; master
    review queue (disputes + no-show confirmations + manual drop).
  - *Complete*: final standings + bracket, frozen.
- **Results** page (archive): list of completed events + per-event detail (standings, bracket,
  all sets).
- Reuse `TournamentTeams` card for teamsheets/review.
- Add `Tournament` and `Results` to `GAME_NAV` in `App.jsx`.

---

## 10. Build order

1. ~~**Pure pairing/standings engine**~~ ✅ **DONE** (round robin, Swiss, standings+
   tiebreakers, playoff seeding, single & double elim, result resolution) — 21 unit tests
   green in `backend/src/tournament/engine.test.js`.
2. ~~**Schema + tournament service**~~ ✅ **DONE** (`tour_*` tables; create/join/reconnect-by-
   clientId/team-submit/review/launch/destroy; `updated_at` bumping; daily `node-cron`
   stale sweep) — 14 service tests green.
3. ~~**Create + lobby flow**~~ ✅ **DONE** — REST routes under `/api/tourney`, `pages/Tournament.jsx`
   (create form, join-by-code, lobby, team picker + validate, organizer review, launch),
   nav + route added. *(Live updates via react-query polling for now; Socket.IO push is a
   deferred enhancement. Running view is a read-only pairings placeholder until layer 4.)*
4. ~~**Match flow**~~ ✅ **DONE** (report + reconcile, dispute→master resolve, no-show→master
   confirm/dismiss, manual drop, open/closed teamsheet reveal) — service + REST + frontend.
5. ~~**Progression + finish**~~ ✅ **DONE** (RR round-activate, Swiss next-round generation,
   Swiss→playoff bracket build, auto playoff advancement, live + final standings, COMPLETE
   snapshot) — 8 match-flow tests; full RR verified e2e via REST.
6. ~~**Results archive**~~ ✅ **DONE** — `getResultDetail` + `GET /results/:code`, `pages/
   TournamentResults.jsx` (list → per-event final standings, every set, teams), nav + route.

Engine first (done) — riskiest logic, fully testable before any UI.

---

## ✅ ALL LAYERS COMPLETE

The tournament subsystem is fully implemented: pure engine (44 unit tests), persistent
server-authoritative service, REST API under `/api/tourney`, and the full frontend
(create → lobby → live match flow → results archive) under the **Games** menu.

**Live updates (Socket.IO) — ✅ DONE.** Clients subscribe to `tourney:<code>` on the shared
Socket.IO server; every REST mutation pushes a lightweight `tournament:changed` signal and
subscribers refetch their own *scoped* view (no full-state-over-socket → zero teamsheet/team
leaks). react-query polling drops to a 20 s safety fallback. Re-subscribes on socket
reconnect. (`tournament/realtime.js` + `mut()` wrapper in the routes.)
