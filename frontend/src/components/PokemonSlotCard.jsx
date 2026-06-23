// src/components/PokemonSlotCard.jsx
import { useEffect, useCallback, memo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getPokemonMeta, getMoveSuggestions, getItemSuggestions, getMoveDetails, getItemDetails } from '../lib/api';
import { normalizeAbility, getEffectiveMoveType } from '../lib/abilityUtils';
import { useRegulation } from '../lib/RegulationContext';
import { PokemonImage, TypePill } from './PokemonCard';

function MoveTypeBadge({ type }) {
  if (!type) return <span style={{ width: 46, flexShrink: 0 }} />;
  return (
    <span style={{
      width: 46, flexShrink: 0, textAlign: 'center',
      fontSize: 9, fontWeight: 700, letterSpacing: '.05em',
      textTransform: 'uppercase',
      color: `var(--t-${type}, #888)`,
      background: `var(--t-${type}-bg, rgba(128,128,128,0.15))`,
      border: `1px solid var(--t-${type}, rgba(128,128,128,0.3))`,
      borderRadius: 4, padding: '2px 0', lineHeight: '14px',
    }}>
      {type}
    </span>
  );
}
import { AutocompleteInput } from './AutocompleteInput';

const NATURES = {
  Hardy:   { plus: null,  minus: null  },
  Lonely:  { plus: 'atk', minus: 'def' },
  Brave:   { plus: 'atk', minus: 'spe' },
  Adamant: { plus: 'atk', minus: 'spa' },
  Naughty: { plus: 'atk', minus: 'spd' },
  Bold:    { plus: 'def', minus: 'atk' },
  Docile:  { plus: null,  minus: null  },
  Relaxed: { plus: 'def', minus: 'spe' },
  Impish:  { plus: 'def', minus: 'spa' },
  Lax:     { plus: 'def', minus: 'spd' },
  Timid:   { plus: 'spe', minus: 'atk' },
  Hasty:   { plus: 'spe', minus: 'def' },
  Serious: { plus: null,  minus: null  },
  Jolly:   { plus: 'spe', minus: 'spa' },
  Naive:   { plus: 'spe', minus: 'spd' },
  Modest:  { plus: 'spa', minus: 'atk' },
  Mild:    { plus: 'spa', minus: 'def' },
  Quiet:   { plus: 'spa', minus: 'spe' },
  Bashful: { plus: null,  minus: null  },
  Rash:    { plus: 'spa', minus: 'spd' },
  Calm:    { plus: 'spd', minus: 'atk' },
  Gentle:  { plus: 'spd', minus: 'def' },
  Sassy:   { plus: 'spd', minus: 'spe' },
  Careful: { plus: 'spd', minus: 'spa' },
  Quirky:  { plus: null,  minus: null  },
};

export const STAT_KEYS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
export const STAT_LABELS = { hp: 'HP', atk: 'Atk', def: 'Def', spa: 'SpA', spd: 'SpD', spe: 'Spe' };

export function natureMult(nature, stat) {
  if (stat === 'hp') return 1;
  const n = NATURES[nature];
  if (!n) return 1;
  if (n.plus === stat) return 1.1;
  if (n.minus === stat) return 0.9;
  return 1;
}

// evPoints: 0-32 (Showdown "stat points" system — 32 = max investment, equiv. to 252 EVs)
// formula: evPoints * 2 replaces floor(ev/4) since floor(evPoints*8/4) = evPoints*2
function calcStat(base, evPoints = 0, stat, nature = 'Hardy') {
  if (!base) return 0;
  const iv = 31, level = 50;
  const inner = Math.floor(((2 * base + iv + evPoints * 2) * level) / 100);
  if (stat === 'hp') return inner + level + 10;
  return Math.floor((inner + 5) * natureMult(nature, stat));
}

function natureLabel(name) {
  const n = NATURES[name];
  if (!n?.plus) return `${name} (neutral)`;
  const L = { atk: 'Atk', def: 'Def', spa: 'SpA', spd: 'SpD', spe: 'Spe' };
  return `${name} (+${L[n.plus]} / −${L[n.minus]})`;
}

const SECTION = { fontSize: 10, letterSpacing: '.07em', color: 'var(--text-muted)', marginBottom: 4, display: 'block' };

const SELECT_STYLE = {
  width: '100%',
  background: 'var(--bg2)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  color: 'var(--text-primary)',
  padding: '7px 10px',
  fontSize: 13,
  outline: 'none',
  cursor: 'pointer',
};

// ── Showdown paste builder (Champions EV scale: 0-32) ────────────────────────
const EV_LABELS = { hp: 'HP', atk: 'Atk', def: 'Def', spa: 'SpA', spd: 'SpD', spe: 'Spe' };

function buildShowdownPaste(pokemon) {
  const item    = pokemon.item    ? ` @ ${pokemon.item}`    : '';
  const ability = pokemon.ability ? `Ability: ${pokemon.ability}` : '';
  const nature  = pokemon.nature  ? `${pokemon.nature} Nature` : '';
  const evLine  = pokemon.evs
    ? 'EVs: ' + Object.entries(pokemon.evs)
        .filter(([, v]) => v > 0)
        .map(([k, v]) => `${v} ${EV_LABELS[k] ?? k}`)
        .join(' / ')
    : '';
  const moves = (pokemon.moves ?? []).filter(Boolean).map(m => `- ${m}`).join('\n');
  return [pokemon.name + item, ability, evLine, nature, moves].filter(Boolean).join('\n');
}

export const PokemonSlotCard = memo(function PokemonSlotCard({ pokemon, onUpdate, onRemove }) {
  const { activeRegId } = useRegulation();
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);

  const handleExport = useCallback(() => {
    const paste = buildShowdownPaste(pokemon);
    navigator.clipboard.writeText(paste).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [pokemon]);

  const { data: meta } = useQuery({
    queryKey: ['meta', pokemon.name, activeRegId],
    queryFn: () => getPokemonMeta(pokemon.name, activeRegId),
    enabled: !!pokemon.name && !!activeRegId,
    staleTime: 5 * 60_000,
  });

  // Pre-fill from meta when first added (no ability set yet).
  // Always persist types + stats when missing (covers Showdown-imported teams).
  useEffect(() => {
    if (!meta) return;

    // Types and stats never change — always sync them if missing
    const needsTypes = meta.types?.length && !pokemon.types?.length;
    const needsStats = meta.stats && !pokemon.stats;

    const needsSprite = !pokemon.spriteUrl && meta.spriteUrl;

    if (pokemon.ability) {
      // Already fully set up — only patch missing types/stats/sprite
      if (needsTypes || needsStats || needsSprite) {
        onUpdate({
          ...pokemon,
          types:     needsTypes  ? meta.types    : pokemon.types,
          stats:     needsStats  ? meta.stats     : pokemon.stats,
          spriteUrl: pokemon.spriteUrl ?? meta.spriteUrl,
          usagePct:  pokemon.usagePct  ?? meta.usagePct,
        });
      }
      return;
    }

    // First time: full pre-fill
    const spread   = meta.spreads?.[0];
    const rawEvs   = spread?.evs ?? {};
    const override = pokemon._speedOverride; // set by SpeedOptimizerModal when adding
    onUpdate({
      ...pokemon,
      types:     meta.types?.length ? meta.types : pokemon.types,
      usagePct:  pokemon.usagePct ?? meta.usagePct,
      spriteUrl: pokemon.spriteUrl ?? meta.spriteUrl,
      stats:     meta.stats,
      ability:   meta.abilities?.[0]?.displayName ?? meta.abilities?.[0]?.name ?? '',
      item:      override?.item ?? (meta.items?.[0]?.displayName ?? meta.items?.[0]?.name ?? ''),
      moves: [
        meta.moves?.[0]?.displayName ?? meta.moves?.[0]?.name ?? '',
        meta.moves?.[1]?.displayName ?? meta.moves?.[1]?.name ?? '',
        meta.moves?.[2]?.displayName ?? meta.moves?.[2]?.name ?? '',
        meta.moves?.[3]?.displayName ?? meta.moves?.[3]?.name ?? '',
      ],
      nature: override?.nature ?? (spread?.nature ?? 'Hardy'),
      evs: override?.evs ?? {
        hp:  rawEvs.hp  ?? 0,
        atk: rawEvs.atk ?? 0,
        def: rawEvs.def ?? 0,
        spa: rawEvs.spa ?? 0,
        spd: rawEvs.spd ?? 0,
        spe: rawEvs.spe ?? 0,
      },
      _speedOverride: undefined, // clear after use
    });
  }, [meta]); // eslint-disable-line react-hooks/exhaustive-deps

  const moves     = pokemon.moves   ?? ['', '', '', ''];
  const filledMoves = moves.filter(Boolean);

  const { data: moveDetails = {} } = useQuery({
    queryKey: ['moveDetails', filledMoves.join(',')],
    queryFn: () => getMoveDetails(filledMoves),
    enabled: filledMoves.length > 0,
    staleTime: Infinity,
  });

  const abilitiesRaw = meta?.abilities?.map(a => a.name) ?? (pokemon.ability ? [pokemon.ability] : []);

  // Ability display names come from the enriched meta response — no extra network call.
  const abilityDetails = Object.fromEntries(
    (meta?.abilities ?? []).map(a => [a.name, { name: a.displayName ?? a.name }])
  );

  // Only fetch item display name if the stored value looks like a raw ID (no spaces, lowercase).
  // When pre-filled from enriched meta the value is already the display name, so skip the call.
  const itemNeedsLookup = !!pokemon.item && pokemon.item === pokemon.item.toLowerCase() && !pokemon.item.includes(' ');
  const { data: itemDetails = {} } = useQuery({
    queryKey: ['itemDetails', pokemon.item ?? ''],
    queryFn: () => getItemDetails([pokemon.item]),
    enabled: itemNeedsLookup,
    staleTime: Infinity,
  });

  const abilityNorm = normalizeAbility(pokemon.ability);
  const evs       = pokemon.evs     ?? { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
  const nature    = pokemon.nature  ?? 'Hardy';
  const baseStats = pokemon.stats   ?? meta?.stats ?? {};
  const totalEvs  = STAT_KEYS.reduce((s, k) => s + (evs[k] ?? 0), 0);
  const abilities = abilitiesRaw;
  const types     = pokemon.types?.length ? pokemon.types : (meta?.types ?? []);
  const usagePct  = pokemon.usagePct ?? meta?.usagePct ?? null;

  // onChange: just update the text as the user types — no duplicate check
  const updateMove = useCallback((i, val) => {
    onUpdate(p => {
      const next = [...(p.moves ?? ['', '', '', ''])];
      next[i] = val;
      return { ...p, moves: next };
    });
  }, [onUpdate]);

  // onSelect: confirmed pick — clear any other slot that already has this move
  const confirmMove = useCallback((i, val) => {
    onUpdate(p => {
      const next = [...(p.moves ?? ['', '', '', ''])];
      const dupeIdx = next.findIndex(
        (m, idx) => idx !== i && m && m.toLowerCase() === val.toLowerCase()
      );
      if (dupeIdx !== -1) next[dupeIdx] = '';
      next[i] = val;
      return { ...p, moves: next };
    });
  }, [onUpdate]);

  // max 32 points per stat, max 66 total
  const updateEv = useCallback((stat, raw) => {
    onUpdate(p => {
      const curEvs = p.evs ?? { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
      let val = Math.min(32, Math.max(0, parseInt(raw) || 0));
      const otherTotal = STAT_KEYS.filter(k => k !== stat).reduce((s, k) => s + (curEvs[k] ?? 0), 0);
      val = Math.min(val, 66 - otherTotal);
      return { ...p, evs: { ...curEvs, [stat]: val } };
    });
  }, [onUpdate]);

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14, position: 'relative' }}>
      {/* View + Export + Remove */}
      <div style={{ position: 'absolute', top: 12, right: 12, display: 'flex', gap: 6 }}>
        <button
          onClick={() => navigate(`/meta?q=${encodeURIComponent(pokemon.name)}`)}
          style={{ padding: '4px 10px', fontSize: 12 }}
        >
          View
        </button>
        <button
          onClick={handleExport}
          title="Copy Showdown paste"
          style={{ padding: '4px 10px', fontSize: 12, color: copied ? '#4ade80' : undefined }}
        >
          {copied ? '✓' : '📋'}
        </button>
        <button
          onClick={onRemove}
          style={{
            width: 24, height: 24, padding: 0,
            background: 'var(--bg3)', border: '1px solid var(--border)',
            borderRadius: 6, fontSize: 12, color: 'var(--text-muted)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', flexShrink: 0,
          }}
        >✕</button>
      </div>

      {/* Header */}
      <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
        <PokemonImage name={pokemon.name} size={96} style={{ flexShrink: 0 }} spriteUrl={pokemon.spriteUrl ?? meta?.spriteUrl} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 6, paddingRight: 72 }}>{pokemon.name}</div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 6 }}>
            {types.map(t => <TypePill key={t} type={t} />)}
          </div>
          {usagePct != null && (
            <div className="mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              {usagePct.toFixed(1)}% usage
            </div>
          )}
        </div>
      </div>

      {/* Ability */}
      <div>
        <span style={SECTION}>ABILITY</span>
        <select
          value={
            // Match stored value case-insensitively against the options list
            abilities.find(a => normalizeAbility(a) === normalizeAbility(pokemon.ability))
            ?? pokemon.ability ?? ''
          }
          onChange={e => onUpdate({ ...pokemon, ability: e.target.value })}
          style={SELECT_STYLE}
        >
          {abilities.length === 0 && <option value="">Loading…</option>}
          {abilities.map(a => (
            <option key={a} value={a}>
              {abilityDetails[a]?.name ?? a}
            </option>
          ))}
        </select>
      </div>

      {/* Item */}
      <div>
        <span style={SECTION}>ITEM</span>
        <AutocompleteInput
          value={itemDetails[pokemon.item]?.name ?? pokemon.item ?? ''}
          onChange={v => onUpdate({ ...pokemon, item: v })}
          onSelect={v => onUpdate({ ...pokemon, item: v })}
          onKeyDown={() => {}}
          placeholder="Search item…"
          fetchSuggestions={q => getItemSuggestions(q, activeRegId)}
          queryKey={`items-${activeRegId}`}
          minChars={2}
        />
      </div>

      {/* Moves */}
      <div>
        <span style={SECTION}>MOVES</span>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          {moves.map((m, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <MoveTypeBadge type={m ? getEffectiveMoveType(moveDetails[m], abilityNorm) : null} />
              <AutocompleteInput
                value={moveDetails[m]?.name ?? m}
                onChange={v => updateMove(i, v)}
                onSelect={v => confirmMove(i, v)}
                onKeyDown={e => { if (e.key === 'Enter') confirmMove(i, moves[i]); }}
                placeholder={`Move ${i + 1}`}
                fetchSuggestions={q => getMoveSuggestions(q, activeRegId, pokemon.name)}
                queryKey={`moves-slot-${activeRegId}-${pokemon.name}`}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Stats + EVs — Showdown style */}
      <div>
        <span style={SECTION}>EVS</span>

        {/* Column headers */}
        <div className="ev-grid" style={{ display: 'grid', gridTemplateColumns: '44px 60px 28px 44px 1fr 28px 36px', gap: 4, alignItems: 'center', marginBottom: 4 }}>
          <span />
          <span style={{ fontSize: 10, color: 'var(--text-muted)', textAlign: 'center' }}>Base</span>
          <span />
          <span style={{ fontSize: 10, color: 'var(--text-muted)', textAlign: 'center' }}>Points</span>
          <span />
          <span style={{ fontSize: 10, color: 'var(--text-muted)', textAlign: 'center' }}>IVs</span>
          <span />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {STAT_KEYS.map(stat => {
            const base  = baseStats[stat] ?? 0;
            const pts   = evs[stat] ?? 0;
            const final = calcStat(base, pts, stat, nature);
            const mult  = natureMult(nature, stat);
            const labelColor = mult > 1 ? '#4ade80' : mult < 1 ? '#f87171' : 'var(--text-secondary)';
            const barColor   = base >= 100 ? '#4ade80' : base >= 70 ? '#a3e635' : base >= 50 ? '#fbbf24' : '#f97316';
            const barWidth   = `${Math.round((base / 255) * 100)}%`;

            return (
              <div key={stat} className="ev-grid" style={{ display: 'grid', gridTemplateColumns: '44px 60px 28px 44px 1fr 28px 36px', gap: 4, alignItems: 'center' }}>
                {/* Stat label */}
                <span style={{ fontSize: 12, fontWeight: 600, color: labelColor, textAlign: 'right', paddingRight: 4 }}>
                  {STAT_LABELS[stat]}
                </span>

                {/* Base stat bar */}
                <div style={{ height: 12, background: 'var(--bg3)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ width: barWidth, height: '100%', background: barColor, borderRadius: 3 }} />
                </div>

                {/* Base stat number */}
                <span className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>
                  {base || '—'}
                </span>

                {/* Points input (0-32) */}
                <input
                  type="number"
                  min={0} max={32}
                  value={pts || ''}
                  placeholder="0"
                  onChange={e => updateEv(stat, e.target.value)}
                  style={{ textAlign: 'center', padding: '3px 2px', fontSize: 12, width: '100%' }}
                />

                {/* Slider (0-32) */}
                <input
                  className="ev-slider"
                  type="range"
                  min={0} max={32} step={1}
                  value={pts}
                  onChange={e => updateEv(stat, e.target.value)}
                  style={{ width: '100%', accentColor: mult > 1 ? '#4ade80' : mult < 1 ? '#f87171' : 'var(--accent)', cursor: 'pointer' }}
                />

                {/* IVs (fixed 31) */}
                <span className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>31</span>

                {/* Final stat */}
                <span className="mono" style={{ fontSize: 13, fontWeight: 700, color: labelColor, textAlign: 'right' }}>
                  {base ? final : '—'}
                </span>
              </div>
            );
          })}
        </div>

        {/* Remaining */}
        <div style={{ textAlign: 'center', marginTop: 6, fontSize: 12, color: 'var(--text-muted)' }}>
          Remaining: <span className="mono" style={{ color: totalEvs > 66 ? '#f87171' : 'var(--text-primary)', fontWeight: 600 }}>
            {66 - totalEvs}
          </span>
        </div>
      </div>

      {/* Nature — below EVs like Showdown */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>Nature:</span>
        <select
          value={nature}
          onChange={e => onUpdate({ ...pokemon, nature: e.target.value })}
          style={{ ...SELECT_STYLE, flex: 1 }}
        >
          {Object.keys(NATURES).map(n => (
            <option key={n} value={n}>{natureLabel(n)}</option>
          ))}
        </select>
      </div>
    </div>
  );
});
