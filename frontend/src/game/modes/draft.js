// game/modes/draft.js
// Pure game logic for the Draft mode. NO React, NO network — just data in/out.
// The SAME functions power local pass-and-play AND networked rooms; only the
// transport around them differs (see useGameRoom).
//
//   meta            static description (used by the lobby + player limits)
//   init(config, source) -> initial state   (source = eligible Pokémon list)
//   reducer(state, action) -> next state    (pure, single-authority)
//
// State shape (fully JSON-serializable so it can be sent over a socket):
//   {
//     phase: 'prep' | 'drafting' | 'done',
//     config: { players, picksPerPlayer },
//     pool:  [{ name, spriteUrl }],   // currently available
//     bench: [{ name, spriteUrl }],   // reroll reserve (prep phase only)
//     picks: [[...], [...]],          // one array per player index
//     turn:  0,                        // whose turn (player index)
//   }

export const meta = {
  id: 'draft',
  label: 'Draft',
  icon: '⬡',
  description: 'A random pool is drawn; players take turns picking until their rosters are full.',
  minPlayers: 2,
  maxPlayers: 8,
  defaultPlayers: 2,
  picksPerPlayer: 12,
};

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const slim = p => ({ name: p.name, spriteUrl: p.spriteUrl ?? null });

// source = array of eligible Pokémon ({ name, spriteUrl, ... }), already filtered.
export function init(config, source = []) {
  const players = Math.max(2, Number(config?.players) || meta.defaultPlayers);
  let picksPerPlayer = Math.max(1, Number(config?.picksPerPlayer) || meta.picksPerPlayer);

  // Cap by what's actually available so we never ask for more than the pool has.
  const maxPool = source.length;
  let poolSize = players * picksPerPlayer;
  if (poolSize > maxPool) {
    picksPerPlayer = Math.floor(maxPool / players);
    poolSize = players * picksPerPlayer;
  }

  const shuffled = shuffle(source).map(slim);
  return {
    phase: 'prep',
    config: { players, picksPerPlayer },
    pool:  shuffled.slice(0, poolSize),
    bench: shuffled.slice(poolSize),
    picks: Array.from({ length: players }, () => []),
    turn:  0,
  };
}

export function totalPicks(state) {
  return state.picks.reduce((n, arr) => n + arr.length, 0);
}
export function poolTarget(state) {
  return state.config.players * state.config.picksPerPlayer;
}

export function reducer(state, action) {
  switch (action.type) {

    // Prep: click a Pokémon to swap it for a random one from the bench.
    case 'reroll': {
      if (state.phase !== 'prep' || state.bench.length === 0) return state;
      const idx = Math.floor(Math.random() * state.bench.length);
      const replacement = state.bench[idx];
      const removed = state.pool.find(p => p.name === action.name);
      if (!removed) return state;
      return {
        ...state,
        pool:  state.pool.map(p => (p.name === action.name ? replacement : p)),
        bench: [...state.bench.filter((_, i) => i !== idx), removed],
      };
    }

    case 'beginDraft':
      return state.phase === 'prep' ? { ...state, phase: 'drafting' } : state;

    // Drafting: player `by` claims a Pokémon. Must be their turn.
    case 'pick': {
      if (state.phase !== 'drafting') return state;
      if (action.by !== state.turn) return state; // not your turn
      const mon = state.pool.find(p => p.name === action.name);
      if (!mon) return state;

      const picks = state.picks.map((arr, i) => (i === action.by ? [...arr, mon] : arr));
      const pool  = state.pool.filter(p => p.name !== action.name);
      const done  = picks.reduce((n, a) => n + a.length, 0) >= poolTarget(state);

      return {
        ...state,
        pool,
        picks,
        phase: done ? 'done' : 'drafting',
        turn:  done ? state.turn : (state.turn + 1) % state.config.players,
      };
    }

    default:
      return state;
  }
}
