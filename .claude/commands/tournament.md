We're working on the live tournament system. Read CLAUDE.md first for the full architecture.

Key files for this session:
- `backend/src/tournament/service.js` — all business logic (create, join, launch, score, advance, close, destroy)
- `backend/src/routes/tournaments.js` — REST surface, `mut()` wrapper broadcasts after mutations
- `backend/src/tournament/store.js` — raw DB queries only, no logic
- `backend/src/tournament/engine.js` — pure algorithms: pairings, standings, bracket building
- `frontend/src/pages/Tournament.jsx` — full live UI (CreateOrJoin → Room → Lobby/Running/Complete)
- `frontend/src/lib/api.js` — all `tourneyXxx` functions

Before touching service.js or engine.js, check if a test exists in `match.test.js` that covers the area. Run tests with:
```
cd backend && node --test src/tournament/match.test.js
```

What needs doing?
