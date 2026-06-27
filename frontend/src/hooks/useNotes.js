// frontend/src/hooks/useNotes.js
// Match-log notes in localStorage. Each note = one logged game.
// Shape:
//   {
//     id, createdAt, updatedAt,
//     result: 'win' | 'lose' | 'draw',
//     myTeamId,                 // ref to a saved team (may be deleted later)
//     myTeamName,               // snapshot — survives rename/delete
//     myTeamSpecies: [string],  // snapshot for "winrate of team X" reporting
//     opponent: { slots: [OppSet | null] × 6 },  // OppSet: {name,nature,item,ability,moves[]}
//     notes: string
//   }
// Snapshots are intentional: reporting must stay truthful even if the source
// team is edited or deleted afterwards.

import { useState, useCallback } from "react";

const STORAGE_KEY = "vgc_notes_v1";
const LAST_TEAM_KEY = "vgc_notes_last_team";

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

function save(notes) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
  } catch {
    console.warn("localStorage full — notes not saved");
  }
}

const newId = () => `note-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

export function useNotes() {
  const [notes, setNotes] = useState(load);

  const addNote = useCallback((note) => {
    const now = new Date().toISOString();
    const full = { ...note, id: newId(), createdAt: now, updatedAt: now };
    setNotes((prev) => {
      const next = [full, ...prev];
      save(next);
      return next;
    });
    return full.id;
  }, []);

  const updateNote = useCallback((id, patch) => {
    setNotes((prev) => {
      const next = prev.map((n) =>
        n.id === id ? { ...n, ...patch, updatedAt: new Date().toISOString() } : n
      );
      save(next);
      return next;
    });
  }, []);

  const deleteNote = useCallback((id) => {
    setNotes((prev) => {
      const next = prev.filter((n) => n.id !== id);
      save(next);
      return next;
    });
  }, []);

  // Merge imported notes by id (existing ids win — import is additive, never
  // overwrites). Returns count of notes actually added.
  const importNotes = useCallback((incoming) => {
    if (!Array.isArray(incoming)) throw new Error("Invalid notes file");
    setNotes((prev) => {
      const seen = new Set(prev.map((n) => n.id));
      const added = incoming.filter((n) => n && n.id && !seen.has(n.id));
      if (!added.length) return prev;
      const next = [...added, ...prev].sort(
        (a, b) => (b.createdAt || "").localeCompare(a.createdAt || "")
      );
      save(next);
      return next;
    });
  }, []);

  return { notes, addNote, updateNote, deleteNote, importNotes };
}

export function getLastTeamId() {
  return localStorage.getItem(LAST_TEAM_KEY) || null;
}
export function setLastTeamId(id) {
  if (id) localStorage.setItem(LAST_TEAM_KEY, id);
}

const LAST_TAGS_KEY = "vgc_notes_last_tags";
export function getLastTags() {
  try {
    const arr = JSON.parse(localStorage.getItem(LAST_TAGS_KEY));
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}
export function setLastTags(tags) {
  try { localStorage.setItem(LAST_TAGS_KEY, JSON.stringify(tags)); } catch { /* quota */ }
}

// ── Reporting helpers (pure) ───────────────────────────────────────────────

export function tally(notes) {
  const t = { win: 0, lose: 0, draw: 0 };
  for (const n of notes) if (t[n.result] != null) t[n.result]++;
  return t;
}

export function winrate(t) {
  const decided = t.win + t.lose; // draws excluded from winrate denominator
  return decided ? t.win / decided : null;
}

// Per-team breakdown, keyed by the snapshotted team name.
export function byTeam(notes) {
  const map = new Map();
  for (const n of notes) {
    const key = n.myTeamName || "(no team)";
    if (!map.has(key)) map.set(key, { name: key, win: 0, lose: 0, draw: 0 });
    const row = map.get(key);
    if (row[n.result] != null) row[n.result]++;
  }
  return [...map.values()].sort(
    (a, b) => b.win + b.lose + b.draw - (a.win + a.lose + a.draw)
  );
}
