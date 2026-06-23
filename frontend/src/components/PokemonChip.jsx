// components/PokemonChip.jsx
// Shared Pokémon card used by Tournament Teams, live tournament match views, and
// the Results archive. Click toggles the expanded detail (ability, moves, nature).
import { useState } from 'react';

const TERA_COLORS = {
  Normal: '#a8a878', Fire: '#f08030', Water: '#6890f0', Electric: '#f8d030',
  Grass: '#78c850', Ice: '#98d8d8', Fighting: '#c03028', Poison: '#a040a0',
  Ground: '#e0c068', Flying: '#a890f0', Psychic: '#f85888', Bug: '#a8b820',
  Rock: '#b8a038', Ghost: '#705898', Dragon: '#7038f8', Dark: '#705848',
  Steel: '#b8b8d0', Fairy: '#ee99ac',
};

export function PokemonChip({ pokemon, expanded, onToggle }) {
  const { name, item, ability, moves, teraType, statAlignment } = pokemon;
  const teraColor = teraType ? (TERA_COLORS[teraType] ?? 'var(--accent)') : null;

  return (
    <div
      onClick={onToggle}
      style={{
        cursor: 'pointer', borderRadius: 8,
        border: `1px solid ${expanded ? 'var(--accent)' : 'var(--border)'}`,
        background: expanded ? 'color-mix(in srgb, var(--accent) 8%, var(--bg2))' : 'var(--bg2)',
        padding: '8px 10px', minWidth: 88, maxWidth: 116, flex: '1 1 88px',
        transition: 'border-color .15s, background .15s', userSelect: 'none',
      }}
    >
      {teraType && (
        <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.04em', color: teraColor, marginBottom: 3, display: 'flex', alignItems: 'center', gap: 3 }}>
          <span style={{ opacity: .7 }}>◆</span> {teraType}
        </div>
      )}
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.2, marginBottom: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {name}
      </div>
      {item && (
        <div style={{ fontSize: 10, color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>@ {item}</div>
      )}
      {expanded && (
        <div style={{ marginTop: 8, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
          {statAlignment && (
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--accent)', marginBottom: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {statAlignment}
            </div>
          )}
          {ability && (
            <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginBottom: 4 }}>
              <span style={{ color: 'var(--text-muted)' }}>Ability: </span>{ability}
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {(moves ?? []).filter(Boolean).map((m, i) => (
              <div key={i} style={{ fontSize: 10, color: 'var(--text-secondary)', paddingLeft: 6, borderLeft: '2px solid var(--accent)' }}>{m}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Normalize a locally-built team slot (My Teams shape) to the chip's shape.
// `nature` maps to the chip's `statAlignment` line (same as RK9 Stat Alignment).
function toChip(pk) {
  return {
    name: pk.name, item: pk.item, ability: pk.ability,
    moves: pk.moves, teraType: pk.teraType ?? null,
    statAlignment: pk.statAlignment ?? pk.nature ?? null,
  };
}

// A row of chips for one team. One toggle expands/collapses the whole sheet.
export function TeamSheet({ team = [], defaultExpanded = false }) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  if (!team.length) return null;
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {team.map((pk, i) => (
        <PokemonChip key={i} pokemon={toChip(pk)} expanded={expanded} onToggle={() => setExpanded(v => !v)} />
      ))}
    </div>
  );
}
