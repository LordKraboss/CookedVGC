// src/components/PokemonCard.jsx
import { useState, useCallback, memo } from 'react';
import { AddToTeamButton } from './AddToTeamButton';
import { getPokemonImageUrl } from '../lib/pokemonImage';

export function TypePill({ type }) {
  return (
    <span
      className="type-pill"
      style={{
        color: `var(--t-${type}, #888)`,
        background: `var(--t-${type}-bg, rgba(128,128,128,0.1))`,
      }}
    >
      {type}
    </span>
  );
}

export function UsageBar({ pct, max = 100 }) {
  return (
    <div className="usage-bar" style={{ flex: 1 }}>
      <div
        className="usage-fill"
        style={{ width: `${Math.min((pct / max) * 100, 100)}%` }}
      />
    </div>
  );
}

// shadow=false by default — drop-shadow is expensive (creates stacking context)
// and kills scroll perf when dozens of images are visible. Only pass shadow=true
// for large hero images where the visual effect is worth the cost.
export function PokemonImage({ name, size = 80, style = {}, spriteUrl = null, shadow = false }) {
  const url = getPokemonImageUrl(name, spriteUrl);

  if (!url) {
    return (
      <div style={{
        width: size, height: size,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--bg3)', borderRadius: 12,
        fontSize: size * 0.4, ...style,
      }}>
        ?
      </div>
    );
  }

  return (
    <img
      src={url}
      alt={name}
      width={size}
      height={size}
      style={{
        objectFit: 'contain',
        imageRendering: 'auto',
        ...(shadow && { filter: 'drop-shadow(0 4px 12px rgba(0,0,0,0.5))' }),
        ...style,
      }}
    />
  );
}

const STAT_LABELS = { hp: 'HP', atk: 'Atk', def: 'Def', spa: 'SpA', spd: 'SpD', spe: 'Spe' };
const statColor = v => v >= 110 ? '#4ade80' : v >= 80 ? '#facc15' : '#f87171';

// Compact row card used in lists — memoised so only changed rows re-render.
// Pass `pokemon` (full object) to enable View + Add buttons and disable whole-row click.
// Pass only `onSelect` (no `pokemon`) to keep the old whole-row-is-clickable behaviour.
export const PokemonRow = memo(function PokemonRow({ name, types = [], abilities = [], stats = null, usagePct, rank, spriteUrl = null, onSelect, onClick, pokemon, children }) {
  const handleView = useCallback(() => {
    if (onSelect) onSelect(name);
    else if (onClick) onClick();
  }, [name, onSelect, onClick]);

  const hasActions = !!pokemon;

  return (
    <div
      className="pokemon-row"
      onClick={!hasActions ? handleView : undefined}
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        background: 'var(--bg2)', border: '1px solid var(--border)',
        borderRadius: 10, padding: '10px 14px',
        cursor: !hasActions ? 'pointer' : 'default',
        textAlign: 'left', width: '100%',
      }}
    >
      {rank !== undefined && (
        <span className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', width: 20, textAlign: 'right', flexShrink: 0 }}>
          {rank}
        </span>
      )}
      <PokemonImage name={name} size={44} spriteUrl={spriteUrl} />
      <div className="pkrow-id" style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {name}
        </div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
          {types.map(t => <TypePill key={t} type={t} />)}
          {abilities.length > 0 && (
            <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--mono)', marginLeft: 4 }}>
              {abilities.map(a => a.name.replace(/\b\w/g, c => c.toUpperCase())).join(' · ')}
            </span>
          )}
        </div>
      </div>
      {stats && (
        <div className="pkrow-stats" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 36px)', gap: '2px 6px', flexShrink: 0 }}>
          {Object.entries(stats).map(([k, v]) => (
            <div key={k} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <span style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'var(--mono)', textTransform: 'uppercase' }}>
                {STAT_LABELS[k] ?? k}
              </span>
              <span style={{ fontSize: 12, fontWeight: 700, fontFamily: 'var(--mono)', color: statColor(v) }}>
                {v}
              </span>
            </div>
          ))}
        </div>
      )}
      {usagePct != null && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <UsageBar pct={usagePct} />
          <span className="mono" style={{ fontSize: 12, color: 'var(--text-secondary)', width: 44, textAlign: 'right' }}>
            {usagePct.toFixed(1)}%
          </span>
        </div>
      )}
      {hasActions && (
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          <button
            onClick={(e) => { e.stopPropagation(); handleView(); }}
            style={{ padding: '5px 10px', fontSize: 12 }}
          >
            View
          </button>
          <AddToTeamButton pokemon={pokemon} />
        </div>
      )}
      {children}
    </div>
  );
});

// Stat bar row
export function StatRow({ label, value, max = 255 }) {
  const pct = (value / max) * 100;
  const color = value >= 100 ? '#78c850' : value >= 70 ? '#f8d030' : '#f08030';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
      <span className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', width: 32, textAlign: 'right', flexShrink: 0 }}>
        {label}
      </span>
      <div style={{ flex: 1, height: 5, background: 'var(--bg3)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 3, transition: 'width .5s ease' }} />
      </div>
      <span className="mono" style={{ fontSize: 12, fontWeight: 500, width: 28, textAlign: 'right', flexShrink: 0 }}>
        {value}
      </span>
    </div>
  );
}

// Section label
export function SectionLabel({ children }) {
  return (
    <div style={{
      fontSize: 10, fontWeight: 700, letterSpacing: '.1em',
      textTransform: 'uppercase', color: 'var(--text-muted)',
      marginBottom: 10, marginTop: 20,
      fontFamily: 'var(--mono)',
    }}>
      {children}
    </div>
  );
}

// Empty state
export function EmptyState({ icon = '🔍', message }) {
  return (
    <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)' }}>
      <div style={{ fontSize: 32, marginBottom: 10 }}>{icon}</div>
      <div style={{ fontSize: 13 }}>{message}</div>
    </div>
  );
}
