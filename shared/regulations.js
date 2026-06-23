/**
 * REGULATION REGISTRY
 * ───────────────────
 * To add a new regulation:
 *   1. Add an entry to REGULATIONS below.
 *   2. Set it as `active: true` (and flip the old one to false, or keep both for archive).
 *   3. Restart the backend — it will auto-sync the new format on startup.
 *
 * Format string must exactly match the Smogon chaos filename prefix:
 *   https://www.smogon.com/stats/{YYYY-MM}/chaos/{format}-0.json
 */

const REGULATIONS = [
  {
    id: "regma",
    label: "Reg MA — Champions BSS",
    format: "gen9championsbssregma",   // ← Smogon chaos filename prefix
    ratingBracket: 0,                  // 0 = all battles, 1500, 1630, 1760 available
    active: true,
    startMonth: "2025-01",            // earliest month to pull; null = latest only
    dexGen: "champions",              // ← Smogon dex URL segment for legal move lookup
  },

  {
    id: "regmb",
    label: "Reg MB — Champions BSS",
    format: "gen9championsbssregmb",   // ← Smogon chaos filename prefix
    ratingBracket: 0,                  // 0 = all battles, 1500, 1630, 1760 available
    active: true,
    startMonth: "2026-06",            // earliest month to pull; null = latest only
    dexGen: "champions",              // ← Smogon dex URL segment for legal move lookup
  },

  // ── Archive / future regs (keep for historical lookups) ─────────────────
  // {
  //   id: "regl",
  //   label: "Reg L — VGC 2024",
  //   format: "gen9vgc2024regl",
  //   ratingBracket: 0,
  //   active: false,
  //   startMonth: "2024-10",
  // },
  // {
  //   id: "regma-1760",
  //   label: "Reg MA — 1760 bracket",
  //   format: "gen9championsbssregma",
  //   ratingBracket: 1760,
  //   active: false,
  //   startMonth: "2025-01",
  // },
];

/** Returns the regulation to use for live data */
const getActiveReg = () => REGULATIONS.find((r) => r.active) ?? REGULATIONS[0];

/** Returns all regulations (for the format switcher in the UI) */
const getAllRegs = () => REGULATIONS;

/** Returns a regulation by its id */
const getRegById = (id) => REGULATIONS.find((r) => r.id === id);

module.exports = { REGULATIONS, getActiveReg, getAllRegs, getRegById };
