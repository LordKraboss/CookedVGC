# Pokémon VGC Tool

Personal web tool for Champions BSS (gen9championsbssregma) team building, moveset analysis, and damage calculation.

## Stack

| Layer | Tech |
|---|---|
| Frontend | React 18 + Vite + React Query + React Router |
| Backend | Node 20 + Express |
| Database | SQLite (better-sqlite3) |
| Stats source | Smogon `chaos/` JSON + PokéAPI |
| Team storage | `localStorage` (up to 50 teams) |

---

## Quick start

```bash
# 1. Backend
cd backend
npm install
mkdir -p ../data          # SQLite lives here
npm run dev               # starts on :3001, auto-syncs Smogon on startup

# 2. Frontend (new terminal)
cd frontend
npm install
npm run dev               # starts on :5173
```

Open http://localhost:5173

---

## Adding a new regulation

Open `shared/regulations.js` and add one entry:

```js
{
  id: "regmb",                          // short unique key
  label: "Reg MB — Next Season",        // shown in the UI dropdown
  format: "gen9championsbssregmb",      // Smogon chaos filename prefix
  ratingBracket: 0,                     // 0 | 1500 | 1630 | 1760
  active: true,                         // set old reg to false
  startMonth: "2025-07",               // earliest month to pull
},
```

Then either restart the backend (auto-syncs on startup) or hit:

```
POST http://localhost:3001/api/regulations/sync
```

---

## Smogon URL pattern

```
https://www.smogon.com/stats/{YYYY-MM}/chaos/{format}-{rating}.json
```

Example:
```
https://www.smogon.com/stats/2025-04/chaos/gen9championsbssregma-0.json
```

The chaos JSON contains per-Pokémon: usage %, moves, items, abilities, EV spreads, and teammate co-occurrence scores.

---

## API endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/api/regulations` | List all regs with sync status |
| POST | `/api/regulations/sync` | Trigger full sync |
| POST | `/api/regulations/:id/sync` | Sync one regulation |
| GET | `/api/usage?reg=regma&limit=100` | Usage rankings |
| GET | `/api/pokemon/:name/meta?reg=regma` | Moveset, spreads, items |
| GET | `/api/moves/:move/learners?reg=regma` | Who can learn this move |
| POST | `/api/team/suggest` | Teammate suggestions for a team |
| GET | `/api/pokemon/:name/base` | PokéAPI base stats (cached) |

---

## Project structure

```
pokemon-vgc/
├── shared/
│   └── regulations.js          ← ADD NEW REGS HERE
├── backend/
│   ├── src/
│   │   ├── app.js              ← entry point + cron
│   │   ├── db/schema.js        ← SQLite tables
│   │   ├── routes/index.js     ← all API routes
│   │   └── services/
│   │       ├── smogonSync.js   ← chaos JSON ingestion
│   │       └── pokeapi.js      ← PokéAPI wrapper
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── lib/
│   │   │   ├── api.js                  ← all fetch calls
│   │   │   └── RegulationContext.jsx  ← active reg state
│   │   └── hooks/
│   │       └── useTeams.js             ← localStorage teams
│   └── package.json
└── data/
    └── vgc.db                  ← SQLite database (auto-created)
```
