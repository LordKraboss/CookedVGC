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

// size="md" (default) is the compact chip used in live tournament team sheets.
// size="lg" is a bigger variant for the Tournament Teams / Results browse pages,
// where the team is the primary content and has room to breathe.
const CHIP_SIZES = {
  md: { minWidth: 88, maxWidth: 116, flexBasis: 88, padding: '8px 10px', radius: 8, tera: 9, name: 12, item: 10, detail: 10, detailGap: 8 },
  lg: { minWidth: 150, maxWidth: 190, flexBasis: 150, padding: '12px 14px', radius: 10, tera: 11, name: 15, item: 13, detail: 13, detailGap: 10 },
};

export function PokemonChip({ pokemon, expanded, onToggle, size = 'md' }) {
  const { name, item, ability, moves, teraType, statAlignment } = pokemon;
  const teraColor = teraType ? (TERA_COLORS[teraType] ?? 'var(--accent)') : null;
  const s = CHIP_SIZES[size] ?? CHIP_SIZES.md;

  return (
    <div
      onClick={onToggle}
      style={{
        cursor: 'pointer', borderRadius: s.radius,
        border: `1px solid ${expanded ? 'var(--accent)' : 'var(--border)'}`,
        background: expanded ? 'color-mix(in srgb, var(--accent) 8%, var(--bg2))' : 'var(--bg2)',
        padding: s.padding, minWidth: s.minWidth, maxWidth: s.maxWidth, flex: `1 1 ${s.flexBasis}px`,
        transition: 'border-color .15s, background .15s', userSelect: 'none',
      }}
    >
      {teraType && (
        <div style={{ fontSize: s.tera, fontWeight: 700, letterSpacing: '.04em', color: teraColor, marginBottom: 3, display: 'flex', alignItems: 'center', gap: 3 }}>
          <span style={{ opacity: .7 }}>◆</span> {teraType}
        </div>
      )}
      <div style={{ fontSize: s.name, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.2, marginBottom: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {name}
      </div>
      {item && (
        <div style={{ fontSize: s.item, color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>@ {item}</div>
      )}
      {expanded && (
        <div style={{ marginTop: s.detailGap, borderTop: '1px solid var(--border)', paddingTop: s.detailGap }}>
          {statAlignment && (
            <div style={{ fontSize: s.detail, fontWeight: 700, color: 'var(--accent)', marginBottom: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {statAlignment}
            </div>
          )}
          {ability && (
            <div style={{ fontSize: s.detail, color: 'var(--text-secondary)', marginBottom: 4 }}>
              <span style={{ color: 'var(--text-muted)' }}>Ability: </span>{ability}
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {(moves ?? []).filter(Boolean).map((m, i) => (
              <div key={i} style={{ fontSize: s.detail, color: 'var(--text-secondary)', paddingLeft: 6, borderLeft: '2px solid var(--accent)' }}>{m}</div>
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
