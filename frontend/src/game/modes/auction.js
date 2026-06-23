// game/modes/auction.js
// Auction mode: players take turns nominating a Pokémon from the pool; everyone
// bids with a starting budget. Highest bidder wins the Pokémon and pays their bid.
// Continue until all players have picksPerPlayer Pokémon.
//
// Timers are stored as { startedAt } timestamps — clients compute remaining time
// locally; only the HOST dispatches the *Timeout actions when the timer expires.

export const meta = {
  id: 'auction',
  label: 'Auction',
  icon: '💰',
  description: 'Each player nominates a Pokémon; everyone bids with a starting budget. Highest bidder wins.',
  minPlayers: 2,
  maxPlayers: 16,
  defaultPlayers: 4,
  picksPerPlayer: 6,
  defaults: {
    startingCash: 1000,
    minIncrement: 50,
    auctionTimer: 10,
  },
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

function randomFrom(arr) {
  if (!arr || arr.length === 0) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

// Returns the next index into order[] whose player has < picksPerPlayer picks.
// Returns -1 when all players are full.
function nextNominatorIdx(order, currentIdx, picks, picksPerPlayer) {
  const n = order.length;
  for (let i = 1; i <= n; i++) {
    const idx = (currentIdx + i) % n;
    if (picks[order[idx]].length < picksPerPlayer) return idx;
  }
  return -1;
}

function beginBidding(state, pokemon, now) {
  const nominator = state.order[state.nominationTurn];
  const autoBidAmount = state.money[nominator] >= state.config.minIncrement
    ? state.config.minIncrement
    : 0;
  return {
    ...state,
    phase: 'bidding',
    pool: state.pool.filter(p => p.name !== pokemon.name),
    currentPokemon: pokemon,
    currentBid: { amount: autoBidAmount, byIndex: nominator },
    bidTimer: { startedAt: now },
    preSelected: null,
    selectionTimer: null,
  };
}

function advanceTurn(state, now) {
  const { picks, order, nominationTurn, pool, config } = state;

  if (picks.every(arr => arr.length >= config.picksPerPlayer) || pool.length === 0) {
    return {
      ...state,
      phase: 'done',
      currentPokemon: null,
      currentBid: null,
      bidTimer: null,
      preSelected: null,
      selectionTimer: null,
    };
  }

  const nextNomIdx = nextNominatorIdx(order, nominationTurn, picks, config.picksPerPlayer);
  if (nextNomIdx === -1) {
    return { ...state, phase: 'done', currentPokemon: null, currentBid: null, bidTimer: null };
  }

  const nextNomPlayerIdx = order[nextNomIdx];

  // 0-money nominator with picks remaining → auto-pick random, skip selection phase
  if (state.money[nextNomPlayerIdx] === 0 && pool.length > 0) {
    const pokemon = randomFrom(pool);
    return {
      ...state,
      phase: 'bidding',
      nominationTurn: nextNomIdx,
      pool: pool.filter(p => p.name !== pokemon.name),
      currentPokemon: pokemon,
      currentBid: { amount: 0, byIndex: nextNomPlayerIdx },
      bidTimer: { startedAt: now },
      preSelected: null,
      selectionTimer: null,
    };
  }

  return {
    ...state,
    phase: 'selection',
    nominationTurn: nextNomIdx,
    preSelected: null,
    selectionTimer: { startedAt: now },
    currentPokemon: null,
    currentBid: null,
    bidTimer: null,
  };
}

export function init(config, source = []) {
  const players = Math.max(2, Number(config?.players) || meta.defaultPlayers);
  const startingCash = Math.max(1, Number(config?.startingCash) || meta.defaults.startingCash);
  const minIncrement = Math.max(1, Number(config?.minIncrement) || meta.defaults.minIncrement);
  const auctionTimer = Number(config?.auctionTimer) || meta.defaults.auctionTimer;
  const { picksPerPlayer } = meta;

  const order = shuffle(Array.from({ length: players }, (_, i) => i));
  const pool  = shuffle(source).map(slim);
  const picks = Array.from({ length: players }, () => []);
  const money = Array.from({ length: players }, () => startingCash);

  return {
    phase: 'selection',
    config: { players, startingCash, minIncrement, auctionTimer, picksPerPlayer },
    order,
    nominationTurn: 0,
    pool,
    picks,
    money,
    preSelected: null,
    selectionTimer: { startedAt: Date.now() },
    currentPokemon: null,
    currentBid: null,
    bidTimer: null,
  };
}

export function reducer(state, action) {
  const now = action.now ?? Date.now();

  switch (action.type) {

    // Nominator clicks a Pokémon to pre-select it (toggle).
    case 'preselectPokemon': {
      if (state.phase !== 'selection') return state;
      const nominator = state.order[state.nominationTurn];
      if (action.by !== nominator) return state;
      const mon = state.pool.find(p => p.name === action.name);
      if (!mon) return state;
      const same = state.preSelected?.name === action.name;
      return { ...state, preSelected: same ? null : mon };
    }

    // Nominator clicks Validate — uses the pre-selected Pokémon.
    case 'confirmSelection': {
      if (state.phase !== 'selection' || !state.preSelected) return state;
      const nominator = state.order[state.nominationTurn];
      if (action.by !== nominator) return state;
      return beginBidding(state, state.preSelected, now);
    }

    // Host fires when 30s expires. Uses pre-selected if set, else random.
    case 'selectionTimeout': {
      if (state.phase !== 'selection') return state;
      const pokemon = state.preSelected ?? randomFrom(state.pool);
      if (!pokemon) return state;
      return beginBidding(state, pokemon, now);
    }

    // Any player places a custom bid (must be ≥ currentBid + minIncrement, ≤ their money).
    case 'placeBid': {
      if (state.phase !== 'bidding') return state;
      const { amount } = action;
      const bidder = action.by;
      if (state.picks[bidder].length >= state.config.picksPerPlayer) return state;
      if (typeof amount !== 'number' || isNaN(amount)) return state;
      if (amount < state.currentBid.amount + state.config.minIncrement) return state;
      if (state.money[bidder] < amount) return state;
      return {
        ...state,
        currentBid: { amount, byIndex: bidder },
        bidTimer: { startedAt: now },
      };
    }

    // Any player auto-increments the current bid by minIncrement.
    case 'autoBid': {
      if (state.phase !== 'bidding') return state;
      const bidder = action.by;
      if (state.picks[bidder].length >= state.config.picksPerPlayer) return state;
      const amount = state.currentBid.amount + state.config.minIncrement;
      if (state.money[bidder] < amount) return state;
      return {
        ...state,
        currentBid: { amount, byIndex: bidder },
        bidTimer: { startedAt: now },
      };
    }

    // Host fires when auction timer expires — award Pokémon to current leader.
    case 'bidTimeout': {
      if (state.phase !== 'bidding') return state;
      const { byIndex, amount } = state.currentBid;
      const picks = state.picks.map((arr, i) =>
        i === byIndex ? [...arr, state.currentPokemon] : arr
      );
      const money = state.money.map((m, i) => i === byIndex ? m - amount : m);
      return advanceTurn({ ...state, picks, money }, now);
    }

    default:
      return state;
  }
}
