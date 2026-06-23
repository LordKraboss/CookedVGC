// frontend/src/hooks/useTeams.js
// Manages up to 50 VGC teams in localStorage.
// Each team: { id, name, reg, slots: [PokemonSet | null] × 6 }
// PokemonSet: { name, types, spriteUrl, nature, evs, moves: string[], item, ability }

import { useState, useCallback } from "react";

const STORAGE_KEY = "vgc_teams_v2";

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    return JSON.parse(raw);
  } catch {
    return defaultState();
  }
}

function defaultState() {
  return {
    activeId: "team-1",
    teams: [{ id: "team-1", name: "Team 1", reg: "regma", slots: Array(6).fill(null) }],
  };
}

function save(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    console.warn("localStorage full — teams not saved");
  }
}

// Debounced save — writes to localStorage at most once per 300ms.
// This keeps the main thread free while the user drags EV sliders.
let _saveTimer = null;
function debouncedSave(state) {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => save(state), 300);
}

export function useTeams() {
  const [state, setState] = useState(load);

  // update() receives a pure function (prev → next) and schedules a save.
  // IMPORTANT: fn must return a new object only when something actually changed.
  // Do NOT use structuredClone here — it creates new references for every nested
  // object, which defeats React.memo on TeamSlotWrapper (all 6 slots re-render
  // even when only 1 changed). Each action does its own minimal clone instead.
  const update = useCallback((fn, { urgent = false } = {}) => {
    setState((prev) => {
      const next = fn(prev);
      if (urgent) save(next); else debouncedSave(next);
      return next;
    });
  }, []);

  const activeTeam = state.teams.find((t) => t.id === state.activeId) ?? state.teams[0];

  // ── Actions ──────────────────────────────────────────────────────────────

  const selectTeam = useCallback((id) =>
    update((s) => ({ ...s, activeId: id }), { urgent: true }),
  [update]);

  const newTeam = useCallback((slots = Array(6).fill(null), name = null) =>
    update((s) => {
      if (s.teams.length >= 50) return s;
      const id = `team-${Date.now()}`;
      const teamName = name ?? `Team ${s.teams.length + 1}`;
      return {
        ...s,
        teams: [...s.teams, { id, name: teamName, reg: "regma", slots }],
        activeId: id,
      };
    }, { urgent: true }),
  [update]);

  const renameTeam = useCallback((id, name) =>
    update((s) => ({
      ...s,
      teams: s.teams.map((t) => t.id === id ? { ...t, name } : t),
    }), { urgent: true }),
  [update]);

  const deleteTeam = useCallback((id) =>
    update((s) => {
      const teams = s.teams.filter((t) => t.id !== id);
      return {
        ...s,
        teams,
        activeId: s.activeId === id ? (teams[0]?.id ?? null) : s.activeId,
      };
    }, { urgent: true }),
  [update]);

  // Hot path — called on every EV/move change. Surgically clones only what
  // changed so sibling TeamSlotWrapper components keep stable prop references
  // and React.memo correctly skips their re-renders.
  const setSlot = useCallback((slotIndex, pokemonOrFn) =>
    update((s) => {
      const teamIdx = s.teams.findIndex((t) => t.id === s.activeId);
      if (teamIdx === -1) return s;
      const team = s.teams[teamIdx];
      const prevPokemon = team.slots[slotIndex];
      const nextPokemon = typeof pokemonOrFn === "function"
        ? pokemonOrFn(prevPokemon)
        : pokemonOrFn;
      if (nextPokemon === prevPokemon) return s; // no change — bail out
      const nextSlots = [...team.slots];
      nextSlots[slotIndex] = nextPokemon;
      const nextTeams = [...s.teams];
      nextTeams[teamIdx] = { ...team, slots: nextSlots };
      return { ...s, teams: nextTeams };
    }),
  [update]);

  const clearSlot = useCallback((slotIndex) => setSlot(slotIndex, null), [setSlot]);

  /** Patch a slot in any team by teamId (used by calculator export) */
  const patchSlotInTeam = useCallback((teamId, slotIndex, patchFn) =>
    update((s) => {
      const teamIdx = s.teams.findIndex(t => t.id === teamId);
      if (teamIdx === -1) return s;
      const team = s.teams[teamIdx];
      const prev = team.slots[slotIndex];
      if (!prev) return s; // slot is empty — nothing to patch
      const next = typeof patchFn === 'function' ? patchFn(prev) : { ...prev, ...patchFn };
      if (next === prev) return s;
      const nextSlots = [...team.slots];
      nextSlots[slotIndex] = next;
      const nextTeams = [...s.teams];
      nextTeams[teamIdx] = { ...team, slots: nextSlots };
      return { ...s, teams: nextTeams };
    }),
  [update]);

  /** Exports active team as Pokémon Showdown paste */
  const exportShowdown = () => {
    const EV_LABELS = { hp: 'HP', atk: 'Atk', def: 'Def', spa: 'SpA', spd: 'SpD', spe: 'Spe' };
    const team = activeTeam;
    return team.slots
      .filter(Boolean)
      .map((p) => {
        const item = p.item ? ` @ ${p.item}` : "";
        const ability = p.ability ? `Ability: ${p.ability}` : "";
        const nature = p.nature ? `${p.nature} Nature` : "";
        const evLine = p.evs
          ? "EVs: " +
            Object.entries(p.evs)
              .filter(([, v]) => v > 0)
              .map(([k, v]) => `${v} ${EV_LABELS[k] ?? k}`)
              .join(" / ")
          : "";
        const moves = (p.moves ?? []).filter(Boolean).map((m) => `- ${m}`).join("\n");
        return [p.name + item, ability, evLine, nature, moves]
          .filter(Boolean)
          .join("\n");
      })
      .join("\n\n");
  };

  return {
    teams: state.teams,
    activeTeam,
    selectTeam,
    newTeam,
    renameTeam,
    deleteTeam,
    setSlot,
    clearSlot,
    patchSlotInTeam,
    exportShowdown,
  };
}
