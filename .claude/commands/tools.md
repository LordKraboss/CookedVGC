We're working on the standalone tools (Calculator and/or Speed Tier). Read CLAUDE.md first.

Key files for this session:
- `frontend/src/pages/Calculator.jsx` — damage calculator UI
- `frontend/src/pages/SpeedTier.jsx` — speed tier comparison tool
- `frontend/src/lib/CalculatorContext.jsx` — calculator state shared across pages (so adding a mon from MetaAnalysis pre-fills it)

These pages are relatively self-contained. They call standard data routes:
- `getPokemonBase(name)` → `/pokemon/:name/base` — base stats (for damage calc inputs)
- `getPokemonMeta(name, reg)` → `/pokemon/:name/meta` — usage spreads (for pre-filling EVs)
- `getPokemonLearnset(name, reg)` → `/pokemon/:name/learnset` — legal moves

No backend changes are usually needed for these tools — they're pure frontend computation using Showdown damage formulas.

What needs doing?
