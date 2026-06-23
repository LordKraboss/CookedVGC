// frontend/src/lib/api.js
// Central API client. All components import from here — never fetch() directly.

const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:3001/api";

async function req(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? "API error");
  }
  return res.json();
}

// ── Regulations ──────────────────────────────────────────────────────────────
export const getRegulations    = ()         => req("/regulations");

// ── Usage ────────────────────────────────────────────────────────────────────
export const getUsage = (reg, limit = 100) =>
  req(`/usage?reg=${reg}&limit=${limit}`);

// ── Pokémon ──────────────────────────────────────────────────────────────────
export const getPokemonMeta     = (name, reg) => req(`/pokemon/${encodeURIComponent(name)}/meta?reg=${reg}`);
export const getPokemonBase     = (name)       => req(`/pokemon/${encodeURIComponent(name)}/base`);
export const getPokemonLearnset = (name, reg) => req(`/pokemon/${encodeURIComponent(name)}/learnset?reg=${reg}`);

// ── Multi-move filter ─────────────────────────────────────────────────────────
export const getPokemonByMoves = (moves, reg) =>
  req(`/pokemon/by-moves?moves=${encodeURIComponent(moves.join(','))}&reg=${reg}`);

// ── Type / ability filter (searches the full pokedex, not just top-N usage) ──
export const getPokemonByFilter = (types, ability, reg) => {
  const params = new URLSearchParams({ reg });
  if (types.length)  params.set('types',   types.join(','));
  if (ability)       params.set('ability', ability);
  return req(`/pokemon/by-filter?${params}`);
};

// ── Autocomplete ──────────────────────────────────────────────────────────────
export const getPokemonSuggestions  = (q, reg) => req(`/pokemon/suggest?q=${encodeURIComponent(q)}&reg=${reg}`);
export const getMoveSuggestions     = (q, reg, pokemon = null) =>
  req(`/moves/suggest?q=${encodeURIComponent(q)}&reg=${reg}${pokemon ? `&pokemon=${encodeURIComponent(pokemon)}` : ''}`);
export const getAbilitySuggestions  = (q, reg) => req(`/abilities/suggest?q=${encodeURIComponent(q)}&reg=${reg}`);
export const getItemSuggestions     = (q, reg) => req(`/items/suggest?q=${encodeURIComponent(q)}&reg=${reg}`);
export const getAbilityDetails      = (names)   => req(`/abilities/details?names=${names.map(encodeURIComponent).join(',')}`);
export const getItemDetails         = (names)   => req(`/items/details?names=${names.map(encodeURIComponent).join(',')}`);
export const getLegalItems          = (reg)     => req(`/items/legal?reg=${reg}`);

// ── Moves ────────────────────────────────────────────────────────────────────
export const getMoveLearners   = (move, reg) => req(`/moves/${encodeURIComponent(move)}/learners?reg=${reg}`);
export const getMoveTypes      = (names)      => req(`/moves/types?names=${names.map(encodeURIComponent).join(',')}`);
export const getMoveDetails    = (names)      => req(`/moves/details?names=${names.map(encodeURIComponent).join(',')}`);

// ── Teams ────────────────────────────────────────────────────────────────────
export const getTeamSuggestions = (team, reg) =>
  req("/team/suggest", {
    method: "POST",
    body: JSON.stringify({ team, reg }),
  });

// ── Tournament Teams (DB-backed, Limitless TCG as source) ────────────────────
// All params optional; DB returns all events when no filter applied.
export const getTournaments = ({ limit = 200, minPlayers = 0, format = '', source = '', since = '' } = {}) => {
  const p = new URLSearchParams({ limit, minPlayers });
  if (format) p.set('format', format);
  if (source) p.set('source', source);
  if (since)  p.set('since',  since);
  return req(`/tournaments/vgc?${p}`);
};
export const getTournamentFormats   = ()   => req('/tournaments/vgc/formats');
export const getTournamentStandings = (id) => req(`/tournaments/vgc/${id}/standings`);

// ── Live tournaments (our own, code-based) ───────────────────────────────────
// Mounted under /tourney to avoid colliding with the RK9 /tournaments/* cache.
const tjBody = (b) => ({ method: 'POST', body: JSON.stringify(b) });
export const tourneyCreate  = (payload)                       => req('/tourney', tjBody(payload));
export const tourneyGet     = (code, clientId)                => req(`/tourney/${code}${clientId ? `?clientId=${encodeURIComponent(clientId)}` : ''}`);
export const tourneyJoin    = (code, clientId, name)          => req(`/tourney/${code}/join`, tjBody({ clientId, name }));
export const tourneySubmitTeam = (code, clientId, team)       => req(`/tourney/${code}/team`, tjBody({ clientId, team }));
export const tourneyRejectTeam = (code, clientId, targetClientId, comment) => req(`/tourney/${code}/team/reject`, tjBody({ clientId, targetClientId, comment }));
export const tourneyLaunch  = (code, clientId)                => req(`/tourney/${code}/launch`, tjBody({ clientId }));
export const tourneyDestroy = (code, clientId)                => req(`/tourney/${code}/destroy`, tjBody({ clientId }));
export const tourneyResults = ()                              => req('/tourney/results');
export const tourneyResult  = (code)                          => req(`/tourney/results/${code}`);
export const tourneyReport  = (code, matchId, clientId, p1Score, p2Score) => req(`/tourney/${code}/matches/${matchId}/report`, tjBody({ clientId, p1Score, p2Score }));
export const tourneyPresent = (code, matchId, clientId)       => req(`/tourney/${code}/matches/${matchId}/present`, tjBody({ clientId }));
export const tourneyNoShow  = (code, matchId, clientId)       => req(`/tourney/${code}/matches/${matchId}/no-show`, tjBody({ clientId }));
export const tourneyResolve = (code, matchId, clientId, payload) => req(`/tourney/${code}/matches/${matchId}/resolve`, tjBody({ clientId, ...payload }));
export const tourneyAdvance = (code, clientId)                => req(`/tourney/${code}/advance`, tjBody({ clientId }));
export const tourneyDrop    = (code, targetClientId, clientId) => req(`/tourney/${code}/participants/${targetClientId}/drop`, tjBody({ clientId }));
export const tourneyComplete = (code, clientId)               => req(`/tourney/${code}/complete`, tjBody({ clientId }));
export const tourneyClose    = (code, clientId)               => req(`/tourney/${code}/close`, tjBody({ clientId }));
