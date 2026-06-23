// Refreshes the Champions mod cache (learnsets + formats-data) from Showdown's
// GitHub and re-syncs learnsets for all active regulations.
//
// Run after a new regulation drops:
//   node src/scripts/refreshChampions.js
//   npm run refresh-champions   (from backend/)
//
const { initSchema } = require("../db/schema");
const { refreshChampionsMod, getLegalChampionsPokemon } = require("../services/championsData");
const { refreshPokedex } = require("../services/showdownData");
const { syncLearnsets } = require("../services/smogonLearnsets");
const { getAllRegs } = require("../../../shared/regulations");

(async () => {
  await initSchema();

  // Base pokedex carries custom-mega stats/abilities (e.g. Mega Pyroar → Fire Mane).
  // The CDN copy updates with each Showdown build; refresh it before re-syncing so
  // pokemon_showdown gets fresh stats and live ability lookups stay current.
  console.log("[refresh] Refreshing base pokedex cache...");
  await refreshPokedex();

  console.log("[refresh] Refreshing Champions mod cache...");
  await refreshChampionsMod();

  const legal = await getLegalChampionsPokemon();
  console.log(`[refresh] Champions legal pool: ${legal.length} Pokémon`);

  const regs = getAllRegs().filter(r => r.dexGen);
  for (const reg of regs) {
    console.log(`[refresh] Re-syncing learnsets for ${reg.id}...`);
    await syncLearnsets(reg, legal, { force: true });
  }

  console.log("[refresh] Done.");
  process.exit(0);
})().catch(err => {
  console.error("[refresh] Failed:", err);
  process.exit(1);
});
