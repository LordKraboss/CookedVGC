// src/pages/ItemDex.jsx
// Item Dex — every item legal in the active regulation and what it does.
// Data: /items/legal?reg= (Champions legal pool + Showdown descriptions +
// category flags, ordered by chaos usage % when a month exists).
import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getLegalItems } from '../lib/api';
import { useRegulation } from '../lib/RegulationContext';

// Display label + ordering for every category flag the backend can emit.
const FLAG_LABELS = {
  mega:     'Mega Stones',
  primal:   'Primal Orbs',
  zcrystal: 'Z-Crystals',
  plate:    'Plates',
  pokeball: 'Poké Balls',
  gem:      'Gems',
  berry:    'Berries',
  choice:   'Choice Items',
};
const FLAG_ORDER = Object.keys(FLAG_LABELS);

// Tri-state cycle: neutral → include → exclude → neutral
const nextState = (s) => (s === 'include' ? 'exclude' : s === 'exclude' ? undefined : 'include');

const INCLUDE = '#4ade80';
const EXCLUDE = '#f87171';
const fmtPct = (p) => p >= 10 ? `${p.toFixed(0)}%` : `${p.toFixed(1)}%`;

export default function ItemDex() {
  const { activeRegId, regs } = useRegulation();
  const [query,   setQuery]   = useState('');
  const [filters, setFilters] = useState({}); // { flag: 'include' | 'exclude' }

  const { data, isLoading, error } = useQuery({
    queryKey: ['legalItems', activeRegId],
    queryFn:  () => getLegalItems(activeRegId),
    enabled:  !!activeRegId,
    staleTime: 10 * 60_000,
  });

  const regLabel = regs.find(r => r.id === activeRegId)?.label ?? activeRegId;
  const hasUsage = data?.hasUsage;

  // Only offer filters for flags actually present in this regulation's pool.
  const availableFlags = useMemo(
    () => FLAG_ORDER.filter(f => data?.flags?.includes(f)),
    [data],
  );

  const cycle = (flag) => setFilters(prev => {
    const ns = nextState(prev[flag]);
    const next = { ...prev };
    if (ns) next[flag] = ns; else delete next[flag];
    return next;
  });

  const items = useMemo(() => {
    if (!data?.items) return [];
    const q = query.trim().toLowerCase();
    const include = Object.entries(filters).filter(([, v]) => v === 'include').map(([f]) => f);
    const exclude = Object.entries(filters).filter(([, v]) => v === 'exclude').map(([f]) => f);
    return data.items.filter(it => {
      if (include.length && !include.some(f => it.flags.includes(f))) return false;
      if (exclude.some(f => it.flags.includes(f))) return false;
      if (q && !it.name.toLowerCase().includes(q) && !(it.desc ?? '').toLowerCase().includes(q)) return false;
      return true;
    });
  }, [data, query, filters]);

  const anyFilter = Object.keys(filters).length > 0;

  return (
    <div style={{ maxWidth: 960 }}>
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-.02em' }}>Item Dex</h1>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>
          Every item legal in <strong style={{ color: 'var(--text-primary)' }}>{regLabel}</strong> and what it does
          {hasUsage ? ', ranked by usage in the current meta.' : '.'}
        </p>
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search items…"
          style={{
            flex: 1, minWidth: 220, padding: '8px 12px', fontSize: 13,
            background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8,
            color: 'var(--text-primary)', outline: 'none', fontFamily: 'var(--mono)',
          }}
        />
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {availableFlags.map(flag => {
            const state = filters[flag];
            const color = state === 'include' ? INCLUDE : state === 'exclude' ? EXCLUDE : null;
            return (
              <button
                key={flag}
                onClick={() => cycle(flag)}
                title={state === 'include' ? 'Showing only these — click to exclude'
                     : state === 'exclude' ? 'Hiding these — click to clear'
                     : 'Click to show only these'}
                style={{
                  padding: '6px 12px', fontSize: 12, borderRadius: 7, cursor: 'pointer',
                  fontWeight: state ? 700 : 500,
                  background: color ? `color-mix(in srgb, ${color} 16%, transparent)` : 'var(--bg2)',
                  border: `1px solid ${color ?? 'var(--border)'}`,
                  color: color ?? 'var(--text-secondary)',
                  display: 'flex', alignItems: 'center', gap: 5,
                }}
              >
                {state && <span style={{ fontWeight: 800 }}>{state === 'include' ? '+' : '−'}</span>}
                {FLAG_LABELS[flag]}
              </button>
            );
          })}
          {anyFilter && (
            <button
              onClick={() => setFilters({})}
              style={{
                padding: '6px 10px', fontSize: 12, borderRadius: 7, cursor: 'pointer',
                background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)',
              }}
            >
              Clear
            </button>
          )}
        </div>
      </div>

      <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginBottom: 12 }}>
        Click a category once to show only it, again to hide it, a third time to reset.
      </div>

      {isLoading && <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading items…</div>}
      {error && <div style={{ color: '#f87171', fontSize: 13 }}>{error.message}</div>}

      {data && (
        <>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--mono)', marginBottom: 8 }}>
            {items.length} of {data.count} items
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {items.map(it => (
              <div key={it.id} style={{
                display: 'flex', alignItems: 'baseline', gap: 12,
                background: 'var(--bg1)', border: '1px solid var(--border)', borderRadius: 10,
                padding: '10px 14px',
              }}>
                <div style={{ minWidth: 150, flexShrink: 0 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-primary)' }}>{it.name}</span>
                  {it.flags.includes('mega') && (
                    <span style={{
                      marginLeft: 8, fontSize: 9, fontWeight: 700, letterSpacing: '.05em',
                      padding: '1px 6px', borderRadius: 5, color: '#c084fc',
                      background: 'color-mix(in srgb, #c084fc 16%, transparent)',
                    }}>MEGA</span>
                  )}
                </div>
                <div style={{ flex: 1, fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.45 }}>
                  {it.desc ?? <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>No description available.</span>}
                </div>
                {hasUsage && it.usagePct > 0 && (
                  <span style={{
                    flexShrink: 0, fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 700,
                    color: it.usagePct >= 5 ? 'var(--accent)' : 'var(--text-muted)', minWidth: 48, textAlign: 'right',
                  }}>{fmtPct(it.usagePct)}</span>
                )}
              </div>
            ))}
            {!items.length && (
              <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '16px 0' }}>
                No items match these filters.
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
