// services/teamValidator.js
// Validates a saved team against a regulation's legal pool.
//
// Legality sources (all already populated by the Champions data pipeline):
//   - species: pokemon_learnsets rows for the reg (mod-legal roster)
//   - moves:   getStoredLearnset(reg, species) — per-Pokémon legal move list
//   - ability: pokedex entry's ability set for that species/forme
//   - item:    getLegalChampionsItems() (Champions regs only)
//
// Restricted/legendary counts and species/item clauses are NOT checked: the
// Champions mod doesn't encode them today. When a reg adds such a rule it will
// surface in the mod data and we extend this then. EV bounds (510 total / 252
// per stat) are a universal game mechanic, so they're checked here.

const { getDb } = require("../db/schema");
const { getStoredLearnset } = require("./smogonLearnsets");
const { getLegalChampionsItems } = require("./championsData");
const { loadPokedex } = require("./showdownData");

function norm(s) { return (s ?? "").toString().toLowerCase().replace(/[^a-z0-9]/g, ""); }

/**
 * @param {{id:string, label?:string, dexGen?:string}} reg
 * @param {Array<object|null>} slots  PokemonSet-shaped objects
 * @returns {Promise<{reg:string, checkable:boolean, legal:boolean, slots:Array}>}
 */
async function validateTeam(reg, slots) {
  const db = await getDb();
  const pokedex = await loadPokedex();

  const speciesRows = db
    .prepare("SELECT pokemon_name FROM pokemon_learnsets WHERE reg_id=?")
    .all(reg.id);
  const legalSpecies = new Set(speciesRows.map((r) => norm(r.pokemon_name)));
  const checkable = legalSpecies.size > 0; // learnsets synced for this reg?

  let legalItemIds = null; // null = don't enforce item legality (non-champions reg)
  if (reg.dexGen === "champions") {
    const items = await getLegalChampionsItems();
    legalItemIds = new Set(items.map((i) => norm(i.id || i.name)));
  }

  const slotResults = [];
  for (let index = 0; index < slots.length; index++) {
    const slot = slots[index];
    if (!slot || !slot.name) continue;

    const problems = [];
    const speciesLegal = !checkable || legalSpecies.has(norm(slot.name));

    if (checkable && !speciesLegal) {
      problems.push(`${slot.name} is not legal in ${reg.label ?? reg.id}`);
    } else if (checkable) {
      // Moves — compared against the stored learnset for this species.
      const learnset = await getStoredLearnset(reg.id, slot.name);
      if (learnset) {
        const legalMoves = new Set(learnset.map(norm));
        for (const move of slot.moves ?? []) {
          if (move && !legalMoves.has(norm(move))) {
            problems.push(`Move "${move}" is not legal on ${slot.name}`);
          }
        }
      }
    }

    // Ability — checked against the pokedex ability set for this forme.
    const entry = pokedex[norm(slot.name)];
    if (slot.ability && entry?.abilities) {
      const legalAbilities = new Set(Object.values(entry.abilities).map(norm));
      if (!legalAbilities.has(norm(slot.ability))) {
        problems.push(`Ability "${slot.ability}" is not legal on ${slot.name}`);
      }
    }

    // Item — Champions regs only.
    if (legalItemIds && slot.item && !legalItemIds.has(norm(slot.item))) {
      problems.push(`Item "${slot.item}" is banned in ${reg.label ?? reg.id}`);
    }

    // EVs — universal cap: 510 total, 252 per stat.
    if (slot.evs) {
      const vals = Object.values(slot.evs).filter((v) => typeof v === "number");
      const total = vals.reduce((a, b) => a + b, 0);
      if (total > 510) problems.push(`EV total ${total} exceeds 510 on ${slot.name}`);
      if (vals.some((v) => v > 252)) problems.push(`An EV exceeds 252 on ${slot.name}`);
    }

    slotResults.push({ index, name: slot.name, legal: problems.length === 0, problems });
  }

  return {
    reg: reg.id,
    checkable,
    legal: slotResults.every((s) => s.legal),
    slots: slotResults,
  };
}

module.exports = { validateTeam };
