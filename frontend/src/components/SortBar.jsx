import { useState } from 'react';

export const SORT_OPTIONS = [
  { key: 'usage', label: 'Usage', defaultDir: 'desc' },
  { key: 'name',  label: 'Name',  defaultDir: 'asc'  },
  { key: 'type',  label: 'Type',  defaultDir: 'asc'  },
  { key: 'hp',    label: 'HP',    defaultDir: 'desc' },
  { key: 'atk',   label: 'Atk',  defaultDir: 'desc' },
  { key: 'def',   label: 'Def',  defaultDir: 'desc' },
  { key: 'spa',   label: 'SpA',  defaultDir: 'desc' },
  { key: 'spd',   label: 'SpD',  defaultDir: 'desc' },
  { key: 'spe',   label: 'Spe',  defaultDir: 'desc' },
];

export function sortPokemon(list, key, dir) {
  return [...list].sort((a, b) => {
    let va, vb;
    if      (key === 'usage') { va = a.usagePct ?? 0;       vb = b.usagePct ?? 0; }
    else if (key === 'name')  { va = a.name;                vb = b.name; }
    else if (key === 'type')  { va = a.types?.[0] ?? '';    vb = b.types?.[0] ?? ''; }
    else                      { va = a.stats?.[key] ?? 0;   vb = b.stats?.[key] ?? 0; }

    if (typeof va === 'string')
      return dir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
    return dir === 'asc' ? va - vb : vb - va;
  });
}

export function usePokemonSort(defaultKey = 'usage') {
  const defaultOpt = SORT_OPTIONS.find(o => o.key === defaultKey);
  const [sortKey, setSortKey] = useState(defaultKey);
  const [sortDir, setSortDir] = useState(defaultOpt?.defaultDir ?? 'desc');

  const handleSort = (key) => {
    const opt = SORT_OPTIONS.find(o => o.key === key);
    if (key === sortKey) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir(opt?.defaultDir ?? 'desc');
    }
  };

  return { sortKey, sortDir, handleSort };
}

export function SortBar({ sortKey, sortDir, onSort, style }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', ...style }}>
      <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--mono)', marginRight: 2 }}>
        SORT
      </span>
      {SORT_OPTIONS.map(({ key, label }) => {
        const active = sortKey === key;
        return (
          <button
            key={key}
            onClick={() => onSort(key)}
            style={{
              padding: '4px 10px', fontSize: 12, fontFamily: 'var(--mono)',
              background: active ? 'var(--accent-dim)' : 'var(--bg2)',
              borderColor: active ? 'var(--accent)' : 'var(--border)',
              color: active ? 'var(--accent)' : 'var(--text-secondary)',
            }}
          >
            {label}{active ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
          </button>
        );
      })}
    </div>
  );
}
