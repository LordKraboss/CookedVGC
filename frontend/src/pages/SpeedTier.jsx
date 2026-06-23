// src/pages/SpeedTier.jsx
import { useMemo, useState, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getUsage } from '../lib/api';
import { useRegulation } from '../lib/RegulationContext';
import { PokemonImage } from '../components/PokemonCard';
import { SpeedOptimizerModal } from '../components/SpeedOptimizerModal';

// ── Speed calculation ──────────────────────────────────────────────────────────
function calcSpe(base, evPoints, natureMult) {
  const inner = Math.floor(((2 * base + 31 + evPoints * 2) * 50) / 100);
  return Math.floor((inner + 5) * natureMult);
}

const scarf = n => Math.floor(n * 3 / 2);
const tw    = n => n * 2;
const n1    = n => Math.floor(n * 2 / 3);
const para  = n => Math.floor(n / 2);

function calcTiers(base) {
  const max = calcSpe(base, 32, 1.1);
  const neu = calcSpe(base, 32, 1.0);
  const ev0 = calcSpe(base, 0,  1.0);
  const neg = calcSpe(base, 0,  0.9);
  return {
    base,
    max,  neu,  ev0,  neg,
    mScarf:   scarf(max),      nScarf:   scarf(neu),
    mTw:      tw(max),         nTw:      tw(neu),         ev0Tw:    tw(ev0),
    mTwN1:    n1(tw(max)),     nTwN1:    n1(tw(neu)),     ev0TwN1:  n1(tw(ev0)),
    mN1:      n1(max),         nN1:      n1(neu),         ev0N1:    n1(ev0),
    mPara:    para(max),       nPara:    para(neu),        ev0Para:  para(ev0),
  };
}

// ── Column definitions ─────────────────────────────────────────────────────────
const COLUMNS = [
  { key: 'base',     label: 'Base',     title: 'Base Speed stat',                          group: 'base'  },
  { key: 'max',      label: 'Max',      title: '252 EVs + boosting nature (×1.1)',          group: 'base'  },
  { key: 'neu',      label: 'Neu',      title: '252 EVs + neutral nature',                  group: 'base'  },
  { key: 'ev0',      label: '0 EV',     title: '0 EVs + neutral nature',                    group: 'base'  },
  { key: 'neg',      label: 'Neg',      title: '0 EVs + reducing nature (×0.9)',             group: 'base'  },
  { key: 'mScarf',   label: 'M+Scarf',  title: 'Max + Choice Scarf (×1.5)',                 group: 'scarf' },
  { key: 'nScarf',   label: 'N+Scarf',  title: 'Neutral + Choice Scarf (×1.5)',             group: 'scarf' },
  { key: 'mTw',      label: 'M TW',     title: 'Max + Tailwind (×2)',                       group: 'tw'    },
  { key: 'nTw',      label: 'N TW',     title: 'Neutral + Tailwind (×2)',                   group: 'tw'    },
  { key: 'ev0Tw',    label: '0 TW',     title: '0 EV + Tailwind (×2)',                      group: 'tw'    },
  { key: 'mTwN1',    label: 'M TW-1',   title: 'Max + Tailwind + −1 stage (×4/3)',          group: 'twn1'  },
  { key: 'nTwN1',    label: 'N TW-1',   title: 'Neutral + Tailwind + −1 stage (×4/3)',      group: 'twn1'  },
  { key: 'ev0TwN1',  label: '0 TW-1',   title: '0 EV + Tailwind + −1 stage (×4/3)',         group: 'twn1'  },
  { key: 'mN1',      label: 'M -1',     title: 'Max + −1 speed stage (×2/3)',               group: 'n1'    },
  { key: 'nN1',      label: 'N -1',     title: 'Neutral + −1 speed stage (×2/3)',            group: 'n1'    },
  { key: 'ev0N1',    label: '0 -1',     title: '0 EV + −1 speed stage (×2/3)',               group: 'n1'    },
  { key: 'mPara',    label: 'M Para',   title: 'Max + Paralysis (÷2)',                      group: 'para'  },
  { key: 'nPara',    label: 'N Para',   title: 'Neutral + Paralysis (÷2)',                  group: 'para'  },
  { key: 'ev0Para',  label: '0 Para',   title: '0 EV + Paralysis (÷2)',                     group: 'para'  },
];

const GROUP_COLORS = {
  base:  'transparent',
  scarf: 'rgba(251,191,36,0.08)',
  tw:    'rgba(104,144,240,0.08)',
  twn1:  'rgba(104,144,240,0.04)',
  n1:    'rgba(248,113,113,0.08)',
  para:  'rgba(168,85,247,0.08)',
};

const GROUP_BORDER = {
  base:  'var(--border)',
  scarf: '#fbbf2440',
  tw:    '#6890f040',
  twn1:  '#6890f020',
  n1:    '#f8717140',
  para:  '#a855f740',
};

const TH_BASE = {
  padding: '7px 8px',
  borderBottom: '1px solid var(--border)',
  color: 'var(--text-muted)',
  fontFamily: 'var(--mono)',
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '.06em',
  textTransform: 'uppercase',
  whiteSpace: 'nowrap',
  textAlign: 'center',
  cursor: 'pointer',
  userSelect: 'none',
};

const TD_BASE = {
  padding: '5px 8px',
  borderBottom: '1px solid var(--border)',
  whiteSpace: 'nowrap',
  textAlign: 'center',
  fontFamily: 'var(--mono)',
  fontSize: 12,
};

// ── Pokémon search / compare input ────────────────────────────────────────────
function PokemonSearchInput({ value, onChange, onAdd, allNames, compareMode }) {
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const wrapperRef = useRef(null);

  const suggestions = useMemo(() => {
    if (!focused || value.length < 1) return [];
    const q = value.toLowerCase();
    return allNames.filter(n => n.toLowerCase().includes(q)).slice(0, 10);
  }, [allNames, value, focused]);

  useEffect(() => {
    setActiveIndex(-1);
    setOpen(focused && value.length >= 1 && suggestions.length > 0);
  }, [suggestions, value, focused]);

  useEffect(() => {
    const handler = (e) => {
      if (!wrapperRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const select = (name) => {
    onAdd(name);
    onChange('');
    setOpen(false);
  };

  const handleKeyDown = (e) => {
    if (open) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIndex(i => Math.min(i + 1, suggestions.length - 1)); return; }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setActiveIndex(i => Math.max(i - 1, -1)); return; }
      if (e.key === 'Enter' && activeIndex >= 0) { e.preventDefault(); select(suggestions[activeIndex]); return; }
      if (e.key === 'Escape') { setOpen(false); return; }
    }
    if (e.key === 'Enter' && value.trim()) {
      const match = allNames.find(n => n.toLowerCase() === value.trim().toLowerCase());
      if (match) select(match);
    }
  };

  const placeholder = compareMode
    ? 'Add another Pokémon to compare…'
    : 'Filter Pokémon… (select one to compare)';

  return (
    <div ref={wrapperRef} style={{ position: 'relative', maxWidth: 360 }}>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={placeholder}
        style={{ width: '100%' }}
      />
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 200,
          background: 'var(--bg1)', border: '1px solid var(--border)',
          borderRadius: 8, overflow: 'hidden',
          boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
        }}>
          {suggestions.map((name, i) => (
            <div
              key={name}
              onMouseDown={() => select(name)}
              onMouseEnter={() => setActiveIndex(i)}
              onMouseLeave={() => setActiveIndex(-1)}
              style={{
                padding: '9px 14px', fontSize: 13, cursor: 'pointer',
                background: i === activeIndex ? 'var(--accent-dim)' : 'transparent',
                color: i === activeIndex ? 'var(--accent)' : 'var(--text-primary)',
                borderBottom: i < suggestions.length - 1 ? '1px solid var(--border)' : 'none',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              }}
            >
              <span>{name}</span>
              <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--mono)' }}>
                {compareMode ? '+ compare' : 'pin'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Component ──────────────────────────────────────────────────────────────────
export default function SpeedTier() {
  const { activeRegId } = useRegulation();
  const [input, setInput]           = useState('');
  const [tags, setTags]             = useState([]);
  const [sortKey, setSortKey]       = useState('base');
  const [sortDir, setSortDir]       = useState('desc');
  const [optimizerPokemon, setOptimizerPokemon] = useState(null);

  const { data: usageList = [], isLoading } = useQuery({
    queryKey: ['usage', activeRegId],
    queryFn: () => getUsage(activeRegId),
    enabled: !!activeRegId,
  });

  const allPokemon = useMemo(
    () => usageList.filter(p => p.stats?.spe > 0),
    [usageList]
  );

  const allNames = useMemo(() => allPokemon.map(p => p.name), [allPokemon]);

  const addTag = (name) => {
    if (!name) return;
    if (tags.some(t => t.toLowerCase() === name.toLowerCase())) return;
    setTags(prev => [...prev, name]);
    setInput('');
  };

  const removeTag = (name) => setTags(prev => prev.filter(t => t !== name));

  const compareMode = tags.length > 0;

  const rows = useMemo(() => {
    const filtered = compareMode
      ? allPokemon.filter(p => tags.some(t => t.toLowerCase() === p.name.toLowerCase()))
      : allPokemon.filter(p => !input || p.name.toLowerCase().includes(input.toLowerCase()));

    return filtered
      .map(p => ({ ...p, tiers: calcTiers(p.stats.spe) }))
      .sort((a, b) => {
        const va = sortKey === 'name' ? a.name : (a.tiers[sortKey] ?? 0);
        const vb = sortKey === 'name' ? b.name : (b.tiers[sortKey] ?? 0);
        if (typeof va === 'string') return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
        return sortDir === 'asc' ? va - vb : vb - va;
      });
  }, [allPokemon, tags, input, compareMode, sortKey, sortDir]);

  const handleSort = (key) => {
    if (key === sortKey) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-.02em' }}>Speed Tier</h1>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>
          Speed values for all Pokémon in the current format. Click a column header to sort.
        </p>
      </div>

      {/* ── Filter / compare bar ── */}
      <div style={{ marginBottom: 16 }}>
        {compareMode && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
            {tags.map(tag => (
              <span key={tag} style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '5px 10px', borderRadius: 8, fontSize: 12,
                fontFamily: 'var(--mono)',
                background: 'var(--accent-dim)', border: '1px solid var(--accent)', color: 'var(--accent)',
              }}>
                {tag}
                <button
                  onClick={() => removeTag(tag)}
                  style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--accent)', fontSize: 14, lineHeight: 1 }}
                >×</button>
              </span>
            ))}
            <button
              onClick={() => { setTags([]); setInput(''); }}
              style={{ fontSize: 11, color: 'var(--text-muted)', padding: '4px 8px' }}
            >
              Clear all
            </button>
          </div>
        )}

        <PokemonSearchInput
          value={input}
          onChange={setInput}
          onAdd={addTag}
          allNames={allNames}
          compareMode={compareMode}
        />
      </div>

      {isLoading && <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Loading…</div>}

      {!isLoading && (
        <div style={{ overflowX: 'auto', borderRadius: 10, border: '1px solid var(--border)' }}>
          <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}>
            <thead>
              <tr style={{ background: 'var(--bg2)' }}>
                <th
                  onClick={() => handleSort('name')}
                  style={{
                    ...TH_BASE,
                    position: 'sticky', left: 0, zIndex: 2,
                    background: 'var(--bg2)',
                    textAlign: 'left', minWidth: 170,
                    borderRight: '1px solid var(--border)',
                  }}
                >
                  Pokémon {sortKey === 'name' ? (sortDir === 'asc' ? '▲' : '▼') : ''}
                </th>

                {COLUMNS.map(c => (
                  <th
                    key={c.key}
                    title={c.title}
                    onClick={() => handleSort(c.key)}
                    style={{
                      ...TH_BASE,
                      background: GROUP_COLORS[c.group],
                      borderLeft: `1px solid ${GROUP_BORDER[c.group]}`,
                      color: sortKey === c.key ? 'var(--accent)' : 'var(--text-muted)',
                    }}
                  >
                    {c.label}{sortKey === c.key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {rows.map((p, i) => (
                <tr key={p.name}>
                  <td style={{
                    ...TD_BASE,
                    textAlign: 'left',
                    position: 'sticky', left: 0, zIndex: 1,
                    background: i % 2 === 0 ? 'var(--bg2)' : 'var(--bg1)',
                    borderRight: '1px solid var(--border)',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <PokemonImage name={p.name} size={24} spriteUrl={p.spriteUrl} />
                      <span
                        onClick={() => setOptimizerPokemon(p)}
                        style={{
                          fontWeight: 600, fontFamily: 'inherit', fontSize: 12,
                          cursor: 'pointer', textDecoration: 'underline',
                          textDecorationColor: 'var(--border)',
                          textUnderlineOffset: 3,
                        }}
                        title="Open speed optimizer"
                      >
                        {p.name}
                      </span>
                      {compareMode && (
                        <button
                          onClick={() => removeTag(p.name)}
                          title="Remove from comparison"
                          style={{
                            marginLeft: 'auto', background: 'none', border: 'none',
                            padding: '0 2px', cursor: 'pointer',
                            color: 'var(--text-muted)', fontSize: 13, lineHeight: 1,
                          }}
                        >×</button>
                      )}
                    </div>
                  </td>
                  {COLUMNS.map(c => (
                    <td
                      key={c.key}
                      style={{
                        ...TD_BASE,
                        background: i % 2 === 0
                          ? blendBg(GROUP_COLORS[c.group])
                          : GROUP_COLORS[c.group],
                        borderLeft: `1px solid ${GROUP_BORDER[c.group]}`,
                        color: sortKey === c.key ? 'var(--text-primary)' : 'var(--text-secondary)',
                        fontWeight: sortKey === c.key ? 700 : 400,
                      }}
                    >
                      {p.tiers[c.key]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!isLoading && rows.length === 0 && (
        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 16 }}>No Pokémon found.</div>
      )}

      {optimizerPokemon && (
        <SpeedOptimizerModal
          pokemon={optimizerPokemon}
          allPokemon={allPokemon}
          onClose={() => setOptimizerPokemon(null)}
        />
      )}
    </div>
  );
}

function blendBg(groupColor) {
  if (groupColor === 'transparent') return 'var(--bg2)';
  return groupColor;
}
