// lib/abilityUtils.js
// Shared ability-effect data used by PokemonSlotCard and TypeCoverageModal.

/** Normalize an ability name for map lookup: lowercase, strip spaces & hyphens. */
export function normalizeAbility(name) {
  return (name ?? '').toLowerCase().replace(/[\s\-]+/g, '');
}

// ── Offensive type changers ───────────────────────────────────────────────────
// Keys are normalized (no spaces). Two variants:
//   { from: type }  → converts moves of that original type
//   { flag: flag }  → converts moves that carry that Showdown flag
export const OFFENSIVE_TYPE_CHANGERS = {
  aerilate:    { from: 'normal', to: 'flying'   },
  dragonize:   { from: 'normal', to: 'dragon'   },
  pixilate:    { from: 'normal', to: 'fairy'    },
  refrigerate: { from: 'normal', to: 'ice'      },
  galvanize:   { from: 'normal', to: 'electric' },
  liquidvoice: { flag: 'sound',  to: 'water'    },
};

/**
 * Returns the effective type of a move for a Pokémon with the given ability.
 * @param {object|null} moveDetail  — full move detail object from /moves/details
 * @param {string}      abilityNorm — normalized ability name (use normalizeAbility())
 * @returns {string|null} effective type (lowercase), or null if unknown
 */
export function getEffectiveMoveType(moveDetail, abilityNorm) {
  const baseType = moveDetail?.type ?? null;
  if (!baseType) return null;
  const changer = OFFENSIVE_TYPE_CHANGERS[abilityNorm];
  if (!changer) return baseType;
  if (changer.from && baseType === changer.from) return changer.to;
  if (changer.flag && moveDetail?.flags?.[changer.flag] === 1) return changer.to;
  return baseType;
}

// ── Defensive ability immunities ──────────────────────────────────────────────
// Keys normalized. Value: { type → override multiplier (0 = immune) }
export const ABILITY_IMMUNITIES = {
  levitate:     { ground: 0 },
  motordrive:   { electric: 0 },
  eartheater:   { ground: 0 },
  sapsipper:    { grass: 0 },
  stormdrain:   { water: 0 },
  dryskin:      { water: 0 },
  waterabsorb:  { water: 0 },
  flashfire:    { fire: 0 },
  lightningrod: { electric: 0 },
  voltabsorb:   { electric: 0 },
};

// Abilities that multiply existing damage rather than setting it to 0
export const ABILITY_MULTIPLIERS = {
  thickfat: { fire: 0.5, ice: 0.5 },
};

// Set of all normalized ability names that visibly affect defensive matchups
export const NOTABLE_DEFENSIVE_ABILITIES = new Set([
  ...Object.keys(ABILITY_IMMUNITIES),
  ...Object.keys(ABILITY_MULTIPLIERS),
  'wonderguard',
]);

/**
 * Applies ability-based defensive modifications to a pre-computed mult map.
 * Returns a new map — does not mutate the input.
 */
export function applyAbilityMods(mults, ability) {
  if (!ability) return mults;
  const ab = normalizeAbility(ability);
  const result = { ...mults };

  const immunity = ABILITY_IMMUNITIES[ab];
  if (immunity) {
    for (const [type, val] of Object.entries(immunity)) result[type] = val;
  }

  const multiplier = ABILITY_MULTIPLIERS[ab];
  if (multiplier) {
    for (const [type, factor] of Object.entries(multiplier)) {
      result[type] = (result[type] ?? 1) * factor;
    }
  }

  if (ab === 'wonderguard') {
    const ALL_TYPES = [
      'normal','fire','water','electric','grass','ice','fighting','poison',
      'ground','flying','psychic','bug','rock','ghost','dragon','dark','steel','fairy',
    ];
    for (const type of ALL_TYPES) {
      if ((result[type] ?? 1) < 2) result[type] = 0;
    }
  }

  return result;
}
