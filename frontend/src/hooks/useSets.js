// frontend/src/hooks/useSets.js
// Saved Pokémon sets in localStorage — standalone movesets independent of any
// team, importable into My Teams or the Calculator.
// Shape: { id, label, name, types, spriteUrl, stats, nature, evs, moves,
//          item, ability, teraType, sourceTeamId, sourceSlot, createdAt, updatedAt }
// sourceTeamId/sourceSlot are set when a set was saved from a My Teams slot —
// they let "Save to Set" / bulk sync find and refresh that same entry instead
// of creating a duplicate each time (mirrors the `team:id:slotIdx` keying the
// Calculator's Set dropdown already uses for the same purpose).

import { useState, useCallback } from "react";

const STORAGE_KEY = "vgc_sets_v1";

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function save(sets) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sets));
  } catch {
    console.warn("localStorage full — sets not saved");
  }
}

const newId = () => `set-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

// Two sets are "the same setup" when species/item/ability/nature/EVs/moves all
// match — label, teraType, sourceTeamId/sourceSlot and other bookkeeping don't
// count. Used to avoid saving exact duplicates when adding a set.
export function isSameSetup(a, b) {
  if (!a || !b) return false;
  const norm = (v) => String(v ?? "").trim().toLowerCase();
  if (norm(a.name) !== norm(b.name)) return false;
  if (norm(a.item) !== norm(b.item)) return false;
  if (norm(a.ability) !== norm(b.ability)) return false;
  if (norm(a.nature || "Hardy") !== norm(b.nature || "Hardy")) return false;
  for (const k of ["hp", "atk", "def", "spa", "spd", "spe"]) {
    if ((a.evs?.[k] ?? 0) !== (b.evs?.[k] ?? 0)) return false;
  }
  const am = a.moves ?? [], bm = b.moves ?? [];
  for (let i = 0; i < 4; i++) {
    if (norm(am[i]) !== norm(bm[i])) return false;
  }
  return true;
}

export function useSets() {
  const [sets, setSets] = useState(load);

  const addSet = useCallback((pokemon) => {
    let resultId = null;
    setSets((prev) => {
      const dupe = prev.find((s) => isSameSetup(s, pokemon));
      if (dupe) {
        resultId = dupe.id;
        return prev;
      }
      const now = new Date().toISOString();
      const full = { label: "", ...pokemon, id: newId(), createdAt: now, updatedAt: now };
      resultId = full.id;
      const next = [full, ...prev];
      save(next);
      return next;
    });
    return resultId;
  }, []);

  // Mirrors useTeams' setSlot: pokemonOrFn resolves against the previous full
  // set object and REPLACES it (not a shallow patch) — this matches how
  // PokemonSlotCard calls onUpdate (always spreads the full pokemon prop).
  const updateSet = useCallback((id, pokemonOrFn) => {
    setSets((prev) => {
      const idx = prev.findIndex((s) => s.id === id);
      if (idx === -1) return prev;
      const prevSet = prev[idx];
      const nextSet = typeof pokemonOrFn === "function" ? pokemonOrFn(prevSet) : pokemonOrFn;
      if (nextSet === prevSet) return prev;
      const next = [...prev];
      next[idx] = { ...nextSet, id, createdAt: prevSet.createdAt, updatedAt: new Date().toISOString() };
      save(next);
      return next;
    });
  }, []);

  const deleteSet = useCallback((id) => {
    setSets((prev) => {
      const next = prev.filter((s) => s.id !== id);
      save(next);
      return next;
    });
  }, []);

  // Save/refresh a set sourced from a specific team slot. Finds an existing
  // entry tagged with the same sourceTeamId/sourceSlot and overwrites it in
  // place. Otherwise, if an identical setup already exists anywhere (it may
  // have come from somewhere else — another team, a manual set), leave that
  // entry untouched and don't claim it for this team; only create a new one
  // when neither match is found. Returns the set's id.
  const upsertSet = useCallback((sourceTeamId, sourceSlot, pokemon, label) => {
    const now = new Date().toISOString();
    let resultId = null;
    setSets((prev) => {
      const linkedIdx = prev.findIndex((s) => s.sourceTeamId === sourceTeamId && s.sourceSlot === sourceSlot);
      if (linkedIdx !== -1) {
        resultId = prev[linkedIdx].id;
        const next = [...prev];
        next[linkedIdx] = { ...prev[linkedIdx], ...pokemon, label, sourceTeamId, sourceSlot, id: resultId, updatedAt: now };
        save(next);
        return next;
      }
      const dupe = prev.find((s) => isSameSetup(s, pokemon));
      if (dupe) {
        resultId = dupe.id;
        return prev;
      }
      resultId = newId();
      const full = { ...pokemon, label, sourceTeamId, sourceSlot, id: resultId, createdAt: now, updatedAt: now };
      const next = [full, ...prev];
      save(next);
      return next;
    });
    return resultId;
  }, []);

  return { sets, addSet, updateSet, deleteSet, upsertSet };
}
