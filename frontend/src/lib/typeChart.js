// src/lib/typeChart.js
// Shared Gen-9 type effectiveness chart + defensive matchup helpers.

export const ALL_TYPES = [
  'normal','fire','water','electric','grass','ice','fighting','poison',
  'ground','flying','psychic','bug','rock','ghost','dragon','dark','steel','fairy',
];

// TYPE_CHART[attacker][defender] = multiplier (only non-1 values stored)
export const TYPE_CHART = {
  normal:   { rock: 0.5, ghost: 0, steel: 0.5 },
  fire:     { fire: 0.5, water: 0.5, rock: 0.5, dragon: 0.5, grass: 2, ice: 2, bug: 2, steel: 2 },
  water:    { water: 0.5, grass: 0.5, dragon: 0.5, fire: 2, ground: 2, rock: 2 },
  electric: { electric: 0.5, grass: 0.5, dragon: 0.5, ground: 0, flying: 2, water: 2 },
  grass:    { fire: 0.5, grass: 0.5, poison: 0.5, flying: 0.5, bug: 0.5, dragon: 0.5, steel: 0.5, water: 2, ground: 2, rock: 2 },
  ice:      { water: 0.5, ice: 0.5, steel: 0.5, grass: 2, ground: 2, flying: 2, dragon: 2 },
  fighting: { poison: 0.5, flying: 0.5, psychic: 0.5, bug: 0.5, ghost: 0, fairy: 0.5, normal: 2, ice: 2, rock: 2, dark: 2, steel: 2 },
  poison:   { poison: 0.5, ground: 0.5, rock: 0.5, ghost: 0.5, steel: 0, grass: 2, fairy: 2 },
  ground:   { grass: 0.5, bug: 0.5, flying: 0, fire: 2, electric: 2, poison: 2, rock: 2, steel: 2 },
  flying:   { electric: 0.5, rock: 0.5, steel: 0.5, grass: 2, fighting: 2, bug: 2 },
  psychic:  { psychic: 0.5, steel: 0.5, dark: 0, fighting: 2, poison: 2 },
  bug:      { fire: 0.5, fighting: 0.5, flying: 0.5, ghost: 0.5, steel: 0.5, fairy: 0.5, grass: 2, psychic: 2, dark: 2 },
  rock:     { fighting: 0.5, ground: 0.5, steel: 0.5, fire: 2, ice: 2, flying: 2, bug: 2 },
  ghost:    { normal: 0, dark: 0.5, ghost: 2, psychic: 2 },
  dragon:   { steel: 0.5, fairy: 0, dragon: 2 },
  dark:     { fighting: 0.5, dark: 0.5, fairy: 0.5, ghost: 2, psychic: 2 },
  steel:    { fire: 0.5, water: 0.5, electric: 0.5, steel: 0.5, ice: 2, rock: 2, fairy: 2 },
  fairy:    { fire: 0.5, poison: 0.5, steel: 0.5, fighting: 2, dragon: 2, dark: 2 },
};

// Defensive multiplier of an attacking type against a set of defending types.
// Case-insensitive on the defender types.
export function effectiveness(atkType, defTypes) {
  let mult = 1;
  for (const def of defTypes) {
    mult *= TYPE_CHART[atkType]?.[def.toLowerCase()] ?? 1;
  }
  return mult;
}

// Given a Pokémon's types, split all attacking types into weaknesses (>1×) and
// resistances (<1×, incl. immunities), each sorted by severity. Neutral excluded.
export function getTypeMatchups(types = []) {
  const defTypes = types.filter(Boolean);
  const weak = [], resist = [];
  for (const atk of ALL_TYPES) {
    const mult = effectiveness(atk, defTypes);
    if (mult > 1) weak.push({ type: atk, mult });
    else if (mult < 1) resist.push({ type: atk, mult });
  }
  weak.sort((a, b) => b.mult - a.mult);
  // Immunities (0×) first, then resistances by least damage reduction (1/2× before 1/4×).
  resist.sort((a, b) => {
    if (a.mult === 0) return -1;
    if (b.mult === 0) return 1;
    return b.mult - a.mult;
  });
  return { weak, resist };
}

// "4×" / "2×" / "1/2×" / "1/4×" / "0×"
export function multLabel(m) {
  if (m === 0)    return '0×';
  if (m === 0.25) return '1/4×';
  if (m === 0.5)  return '1/2×';
  return `${m}×`;
}
