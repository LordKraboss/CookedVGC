// src/components/TypeCoverageModal.jsx
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getMoveDetails } from '../lib/api';
import {
  normalizeAbility,
  OFFENSIVE_TYPE_CHANGERS,
  getEffectiveMoveType,
  NOTABLE_DEFENSIVE_ABILITIES,
  applyAbilityMods,
} from '../lib/abilityUtils';
import { ALL_TYPES, effectiveness } from '../lib/typeChart';

// Shared defensive multiplier styling
function multStyle(m) {
  if (m === 0)    return { background: 'rgba(0,0,0,0.4)',          color: '#555',    label: '0×' };
  if (m >= 4)     return { background: 'rgba(220,38,38,0.35)',      color: '#ef4444', label: '4×' };
  if (m >= 2)     return { background: 'rgba(239,68,68,0.18)',      color: '#f87171', label: '2×' };
  if (m <= 0.25)  return { background: 'rgba(74,222,128,0.30)',     color: '#4ade80', label: '¼×' };
  if (m < 1)      return { background: 'rgba(74,222,128,0.14)',     color: '#86efac', label: '½×' };
  return            { background: 'transparent',                    color: 'var(--text-muted)', label: '·' };
}

function TypeBadge({ type, small }) {
  return (
    <span style={{
      display: 'inline-block',
      padding: small ? '1px 5px' : '2px 7px',
      borderRadius: 4,
      fontSize: small ? 9 : 10,
      fontWeight: 700,
      letterSpacing: '.05em',
      textTransform: 'uppercase',
      color: `var(--t-${type}, #888)`,
      background: `var(--t-${type}-bg, rgba(128,128,128,0.15))`,
      border: `1px solid var(--t-${type}, rgba(128,128,128,0.3))`,
      whiteSpace: 'nowrap',
    }}>
      {type}
    </span>
  );
}

function MultCell({ mult }) {
  const { background, color, label } = multStyle(mult);
  return (
    <td style={{
      padding: '3px 2px',
      textAlign: 'center',
      fontSize: label === '·' ? 13 : 11,
      fontWeight: 700,
      color,
      background,
      borderRadius: 3,
      minWidth: 30,
    }}>
      {label}
    </td>
  );
}

// ── Offensive panel ───────────────────────────────────────────────────────────
// Rows = 18 defending types. Columns = each Pokémon.
// Cell = best effectiveness any of their damaging moves achieves vs that type:
//   +2 (SE), +1 (neutral), −1 (resisted), Imm (immune).
// Status moves are excluded.

function offCellStyle(best) {
  if (!isFinite(best)) return { label: '—',   color: 'var(--text-muted)',   bg: 'transparent' };
  if (best === 0)       return { label: 'Imm', color: '#6b7280',             bg: 'rgba(0,0,0,0.35)' };
  if (best >= 2)        return { label: '+2',  color: '#4ade80',             bg: 'rgba(74,222,128,0.18)' };
  if (best === 1)       return { label: '+1',  color: '#60a5fa',             bg: 'rgba(96,165,250,0.13)' };
  return                       { label: '−1',  color: '#f87171',             bg: 'rgba(239,68,68,0.13)' };
}

function OffensivePanel({ pokemon, moveDetails }) {
  if (pokemon.length === 0) {
    return <p style={{ color: 'var(--text-muted)', padding: '24px 0' }}>No Pokémon in team.</p>;
  }

  const noDetails = Object.keys(moveDetails).length === 0;
  if (noDetails) {
    return <p style={{ color: 'var(--text-muted)', padding: '24px 0' }}>No moves with known types in this team.</p>;
  }

  // For each Pokémon, get their damaging move types and compute best vs each defending type
  const teamData = pokemon.map(p => {
    const abilityNorm = normalizeAbility(p.ability);

    const damagingTypes = (p.moves ?? [])
      .filter(Boolean)
      .map(m => moveDetails[m])
      .filter(d => d?.category && d.category !== 'Status' && d.type)
      .map(d => getEffectiveMoveType(d, abilityNorm));

    const bestVs = Object.fromEntries(
      ALL_TYPES.map(def => [
        def,
        damagingTypes.length > 0
          ? Math.max(...damagingTypes.map(atk => effectiveness(atk, [def])))
          : -Infinity,
      ])
    );

    return { name: p.name, types: p.types, bestVs, hasMoves: damagingTypes.length > 0 };
  });

  // Build per-type summary and sort: most SE coverage first, then neutral, gaps last
  const typeRows = ALL_TYPES.map(def => {
    const active = teamData.filter(p => p.hasMoves);
    return {
      type:       def,
      seCount:    active.filter(p => p.bestVs[def] >= 2).length,
      neutCount:  active.filter(p => p.bestVs[def] === 1).length,
      noCvrCount: active.filter(p => isFinite(p.bestVs[def]) && p.bestVs[def] < 1).length,
    };
  });
  typeRows.sort((a, b) =>
    b.seCount - a.seCount ||
    b.neutCount - a.neutCount ||
    a.noCvrCount - b.noCvrCount
  );

  const COL_TH = {
    padding: '3px 6px', textAlign: 'center', minWidth: 44,
    fontSize: 10, color: 'var(--text-muted)', fontWeight: 600,
  };

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'separate', borderSpacing: '1px', fontSize: 11 }}>
        <thead>
          <tr>
            <th style={{ padding: '3px 8px', textAlign: 'left', color: 'var(--text-muted)', fontWeight: 600, fontSize: 10, minWidth: 80 }}>
              DEF TYPE ↓
            </th>
            {teamData.map(p => (
              <th key={p.name} style={{ padding: '3px 6px', textAlign: 'center', minWidth: 70 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 2 }}>{p.name}</div>
                <div style={{ display: 'flex', gap: 2, justifyContent: 'center' }}>
                  {p.types.map(t => <TypeBadge key={t} type={t} small />)}
                </div>
              </th>
            ))}
            <th style={COL_TH}>SE</th>
            <th style={COL_TH}>NO CVR</th>
          </tr>
        </thead>
        <tbody>
          {typeRows.map(({ type: def, seCount, noCvrCount }) => {
            const rowHighlight = noCvrCount >= 3 ? 'rgba(239,68,68,0.04)' : 'transparent';
            return (
              <tr key={def} style={{ background: rowHighlight }}>
                <td style={{ padding: '2px 8px', whiteSpace: 'nowrap' }}>
                  <TypeBadge type={def} small />
                </td>
                {teamData.map(p => {
                  const { label, color, bg } = offCellStyle(p.bestVs[def]);
                  return (
                    <td key={p.name} style={{
                      padding: '3px 2px', textAlign: 'center',
                      fontSize: 11, fontWeight: 700, color, background: bg, borderRadius: 3,
                    }}>
                      {label}
                    </td>
                  );
                })}
                {/* SE count */}
                <td style={{
                  padding: '3px 6px', textAlign: 'center', fontWeight: 700, fontSize: 12,
                  color: seCount > 0 ? '#4ade80' : 'var(--text-muted)',
                }}>
                  {seCount > 0 ? seCount : '·'}
                </td>
                {/* No-coverage count */}
                <td style={{
                  padding: '3px 6px', textAlign: 'center', fontWeight: 700, fontSize: 12,
                  color: noCvrCount >= teamData.filter(p => p.hasMoves).length && noCvrCount > 0
                    ? '#ef4444'
                    : noCvrCount > 0 ? '#f97316' : 'var(--text-muted)',
                }}>
                  {noCvrCount > 0 ? noCvrCount : '·'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div style={{ marginTop: 6, fontSize: 10, color: 'var(--text-muted)' }}>
        Rows sorted by best team coverage first. Status moves excluded. NO CVR = Pokémon with no neutral or SE move vs this type.
      </div>
    </div>
  );
}

// ── Defensive panel ───────────────────────────────────────────────────────────
function DefensivePanel({ pokemon }) {
  if (pokemon.length === 0) {
    return <p style={{ color: 'var(--text-muted)', padding: '24px 0' }}>No Pokémon in team.</p>;
  }

  // Per-Pokémon: mult each attacking type does against them, then apply ability mods
  const teamData = pokemon.map(p => {
    const baseMults = Object.fromEntries(ALL_TYPES.map(atk => [atk, effectiveness(atk, p.types ?? [])]));
    const mults = applyAbilityMods(baseMults, p.ability);
    const abilityLabel = NOTABLE_DEFENSIVE_ABILITIES.has(normalizeAbility(p.ability)) ? p.ability : null;
    return { name: p.name, types: p.types ?? [], ability: p.ability ?? '', abilityLabel, mults };
  });

  // Count weak/resist per attacking type; sort most dangerous first
  const typeSummary = ALL_TYPES.map(atk => ({
    type: atk,
    weak4:   teamData.filter(p => p.mults[atk] >= 4).length,
    weak2:   teamData.filter(p => p.mults[atk] >= 2 && p.mults[atk] < 4).length,
    resist:  teamData.filter(p => p.mults[atk] > 0 && p.mults[atk] < 1).length,
    immune:  teamData.filter(p => p.mults[atk] === 0).length,
  }));
  typeSummary.sort((a, b) => (b.weak4 * 2 + b.weak2) - (a.weak4 * 2 + a.weak2));

  const SUMMARY_TH = { padding: '3px 6px', textAlign: 'center', fontSize: 10, color: 'var(--text-muted)', minWidth: 44 };

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'separate', borderSpacing: '1px', fontSize: 11 }}>
        <thead>
          <tr>
            <th style={{ padding: '3px 8px', textAlign: 'left', color: 'var(--text-muted)', fontWeight: 600, fontSize: 10, minWidth: 80 }}>
              INCOMING →
            </th>
            {teamData.map(p => (
              <th key={p.name} style={{ padding: '3px 6px', textAlign: 'center', minWidth: 70 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 2 }}>{p.name}</div>
                <div style={{ display: 'flex', gap: 2, justifyContent: 'center', marginBottom: p.abilityLabel ? 2 : 0 }}>
                  {p.types.map(t => <TypeBadge key={t} type={t} small />)}
                </div>
                {p.abilityLabel && (
                  <div style={{ fontSize: 8, color: 'var(--accent)', fontWeight: 600, letterSpacing: '.04em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 80 }}>
                    {p.abilityLabel}
                  </div>
                )}
              </th>
            ))}
            <th style={SUMMARY_TH}>WEAK</th>
            <th style={SUMMARY_TH}>RESIST</th>
          </tr>
        </thead>
        <tbody>
          {typeSummary.map(({ type: atk, weak4, weak2, resist, immune }) => {
            const totalWeak = weak4 + weak2;
            const totalResist = resist + immune;
            const rowHighlight = weak4 > 0 ? 'rgba(220,38,38,0.07)' : weak2 >= 2 ? 'rgba(239,68,68,0.04)' : 'transparent';
            return (
              <tr key={atk} style={{ background: rowHighlight }}>
                <td style={{ padding: '2px 8px', whiteSpace: 'nowrap' }}>
                  <TypeBadge type={atk} small />
                </td>
                {teamData.map(p => (
                  <MultCell key={p.name} mult={p.mults[atk]} />
                ))}
                {/* Weak column */}
                <td style={{ padding: '3px 6px', textAlign: 'center', fontWeight: 700, fontSize: 11 }}>
                  {weak4 > 0 && <span style={{ color: '#ef4444' }}>{weak4}<span style={{ fontSize: 9 }}>×4</span> </span>}
                  {weak2 > 0 && <span style={{ color: '#f97316' }}>{weak2}</span>}
                  {totalWeak === 0 && <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>·</span>}
                </td>
                {/* Resist column */}
                <td style={{ padding: '3px 6px', textAlign: 'center', fontWeight: 700, fontSize: 11 }}>
                  {immune > 0 && <span style={{ color: '#4ade80' }}>{immune}<span style={{ fontSize: 9 }}>imm</span> </span>}
                  {resist > 0 && <span style={{ color: '#86efac' }}>{resist}</span>}
                  {totalResist === 0 && <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>·</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div style={{ marginTop: 6, fontSize: 10, color: 'var(--text-muted)' }}>
        Rows sorted by most dangerous type first. Red rows = multiple team members weak.
      </div>
    </div>
  );
}

// ── Main modal ────────────────────────────────────────────────────────────────
export function TypeCoverageModal({ team, onClose }) {
  const [tab, setTab] = useState('offensive');

  // Normalize types to lowercase (guard against capitalized values from some code paths)
  const activePokemon = team.filter(Boolean).map(p => ({
    ...p,
    types: (p.types ?? []).map(t => t.toLowerCase()),
  }));
  const allMoves = [...new Set(activePokemon.flatMap(p => (p.moves ?? []).filter(Boolean)))];

  const { data: moveDetails = {}, isLoading } = useQuery({
    queryKey: ['moveDetails', allMoves.join(',')],
    queryFn: () => getMoveDetails(allMoves),
    enabled: allMoves.length > 0,
    staleTime: Infinity,
  });

  const offLegend = [
    { label: '+2',  bg: 'rgba(74,222,128,0.18)',  color: '#4ade80',           desc: 'super effective' },
    { label: '+1',  bg: 'rgba(96,165,250,0.13)',   color: '#60a5fa',           desc: 'neutral' },
    { label: '−1',  bg: 'rgba(239,68,68,0.13)',    color: '#f87171',           desc: 'resisted' },
    { label: 'Imm', bg: 'rgba(0,0,0,0.35)',        color: '#6b7280',           desc: 'immune' },
  ];

  const defLegend = [
    { label: '4×', bg: 'rgba(220,38,38,0.35)',   color: '#ef4444', desc: 'quad weakness' },
    { label: '2×', bg: 'rgba(239,68,68,0.18)',   color: '#f87171', desc: 'weakness' },
    { label: '·',  bg: 'transparent',            color: 'var(--text-muted)', desc: 'neutral' },
    { label: '½×', bg: 'rgba(74,222,128,0.14)',  color: '#86efac', desc: 'resist' },
    { label: '¼×', bg: 'rgba(74,222,128,0.30)',  color: '#4ade80', desc: 'double resist' },
    { label: '0×', bg: 'rgba(0,0,0,0.4)',        color: '#555',    desc: 'immune' },
  ];

  const legend = tab === 'offensive' ? offLegend : defLegend;

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12 }}
      onClick={onClose}
    >
      <div
        className="card"
        style={{ width: 'fit-content', maxWidth: 'min(98vw, 1200px)', maxHeight: '96vh', display: 'flex', flexDirection: 'column', position: 'relative', overflowY: 'auto', overflowX: 'auto' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10, flexShrink: 0 }}>
          <h2 style={{ fontSize: 18, fontWeight: 800, margin: 0, whiteSpace: 'nowrap' }}>Type Coverage</h2>
          <div style={{ display: 'flex', gap: 5 }}>
            {[{ key: 'offensive', label: '⚔ Offensive' }, { key: 'defensive', label: '🛡 Defensive' }].map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                style={{
                  padding: '5px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  background: tab === key ? 'var(--accent)' : 'var(--bg2)',
                  color: tab === key ? '#fff' : 'var(--text-secondary)',
                  border: `1px solid ${tab === key ? 'var(--accent)' : 'var(--border)'}`,
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <div style={{ flex: 1 }} />
          <button
            onClick={onClose}
            style={{ width: 26, height: 26, padding: 0, background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', color: 'var(--text-muted)', fontSize: 13, flexShrink: 0 }}
          >✕</button>
        </div>

        {/* Legend */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 10, flexShrink: 0, flexWrap: 'wrap' }}>
          {legend.map(({ label, bg, color, desc }) => (
            <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--text-muted)' }}>
              <span style={{ display: 'inline-block', width: 32, textAlign: 'center', borderRadius: 3, padding: '1px 3px', background: bg, color, fontWeight: 700, fontSize: 10 }}>{label}</span>
              {desc}
            </span>
          ))}
        </div>

        {/* Content */}
        <div style={{ flexShrink: 0 }}>
          {isLoading
            ? <div style={{ color: 'var(--text-muted)', padding: '40px 0', textAlign: 'center' }}>Computing coverage…</div>
            : tab === 'offensive'
              ? <OffensivePanel pokemon={activePokemon} moveDetails={moveDetails} />
              : <DefensivePanel pokemon={activePokemon} />
          }
        </div>
      </div>
    </div>
  );
}
