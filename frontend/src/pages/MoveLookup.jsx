// src/pages/MoveLookup.jsx
import { useState, useCallback, useRef, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getPokemonByMoves, getPokemonByFilter, getUsage, getMoveSuggestions, getAbilitySuggestions } from '../lib/api';
import { useRegulation } from '../lib/RegulationContext';
import { PokemonRow, EmptyState, SectionLabel } from '../components/PokemonCard';
import { AutocompleteInput } from '../components/AutocompleteInput';
import { SortBar, sortPokemon, usePokemonSort } from '../components/SortBar';
import NoStatsBanner from '../components/NoStatsBanner';

const QUICK_MOVES = [
  'Fake Out', 'Upper Hand', 'Tailwind', 'Trick Room', 'Electroweb', 'Icy Wind',
  'Wide Guard', 'Helping Hand', 'Spore', 'Thunder Wave', 'Follow Me', 'Rage Powder',
  'Taunt', 'Encore', 'Disable', 'Quash', 'Reflect', 'Light Screen', 'Aurora Veil',
  'Ally Switch', 'Feint',
];

const ALL_TYPES = [
  'normal','fire','water','electric','grass','ice','fighting','poison',
  'ground','flying','psychic','bug','rock','ghost','dragon','dark','steel','fairy',
];

export default function MoveLookup() {
  const { activeRegId, activeReg } = useRegulation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // Restore filter state from URL on mount
  const [tags, setTagsRaw] = useState(() =>
    searchParams.get('moves') ? searchParams.get('moves').split(',').filter(Boolean) : []
  );
  const [moveInput, setMoveInput] = useState('');

  const [typeFilters, setTypeFiltersRaw] = useState(() =>
    searchParams.get('types') ? searchParams.get('types').split(',').filter(Boolean) : []
  );

  const [abilityFilter, setAbilityFilterRaw] = useState(() => searchParams.get('ability') ?? '');
  const [abilityInput, setAbilityInput] = useState(() => searchParams.get('ability') ?? '');

  // Sync state to URL so navigate(-1) restores filters
  const syncUrl = (newTags, newTypes, newAbility) => {
    const p = {};
    if (newTags.length) p.moves = newTags.join(',');
    if (newTypes.length) p.types = newTypes.join(',');
    if (newAbility) p.ability = newAbility;
    setSearchParams(p, { replace: true });
  };

  // Compute next value OUTSIDE the state updater so syncUrl (→ setSearchParams)
  // is never called during rendering, which would update BrowserRouter mid-render.
  const setTags = (fn) => {
    const next = typeof fn === 'function' ? fn(tags) : fn;
    setTagsRaw(next);
    syncUrl(next, typeFilters, abilityFilter);
  };

  const setTypeFilters = (fn) => {
    const next = typeof fn === 'function' ? fn(typeFilters) : fn;
    setTypeFiltersRaw(next);
    syncUrl(tags, next, abilityFilter);
  };

  const setAbilityFilter = (val) => {
    setAbilityFilterRaw(val);
    syncUrl(tags, typeFilters, val);
  };

  const addTag = (move) => {
    const m = move.trim();
    if (!m) return;
    if (tags.some(t => t.toLowerCase() === m.toLowerCase())) return;
    setTags(prev => [...prev, m]);
    setMoveInput('');
  };

  const removeTag = (move) => setTags(prev => prev.filter(t => t !== move));

  const toggleQuick = (move) => {
    if (tags.some(t => t.toLowerCase() === move.toLowerCase()))
      removeTag(tags.find(t => t.toLowerCase() === move.toLowerCase()));
    else addTag(move);
  };

  const toggleType = (type) => {
    if (typeFilters.includes(type)) {
      setTypeFilters(prev => prev.filter(t => t !== type));
    } else if (typeFilters.length < 2) {
      setTypeFilters(prev => [...prev, type]);
    }
  };

  const setAbility = (name) => {
    setAbilityFilter(name);        // store proper display name
    setAbilityInput(name);
  };

  const clearAbility = () => { setAbilityFilter(''); setAbilityInput(''); };

  const { sortKey, sortDir, handleSort } = usePokemonSort('usage');

  const goToMeta = useCallback((name) => {
    navigate(`/meta?q=${encodeURIComponent(name)}`);
  }, [navigate]);
  const hasFilters = tags.length > 0 || typeFilters.length > 0 || abilityFilter;

  // Fetch move-filtered list (when moves selected)
  const { data: byMovesData = [], isLoading: movesLoading } = useQuery({
    queryKey: ['byMoves', tags.join(','), activeRegId],
    queryFn: () => getPokemonByMoves(tags, activeRegId),
    enabled: tags.length > 0 && !!activeRegId,
  });

  // Fetch type/ability-filtered list from full pokedex (when no moves selected)
  const typeAbilityActive = tags.length === 0 && (typeFilters.length > 0 || !!abilityFilter);
  const { data: byFilterData = [], isLoading: filterLoading } = useQuery({
    queryKey: ['byFilter', typeFilters.join(','), abilityFilter, activeRegId],
    queryFn: () => getPokemonByFilter(typeFilters, abilityFilter, activeRegId),
    enabled: typeAbilityActive && !!activeRegId,
  });

  // Fetch full usage list (shown when no filters at all — the default list)
  const { data: usageData = [], isLoading: usageLoading } = useQuery({
    queryKey: ['usage', activeRegId],
    queryFn: () => getUsage(activeRegId),
    enabled: !!activeRegId,
  });

  // Pick the right source and loading state
  const isLoading = tags.length > 0 ? movesLoading : typeAbilityActive ? filterLoading : usageLoading;

  // Choose base dataset
  const base = tags.length > 0 ? byMovesData : typeAbilityActive ? byFilterData : usageData;

  // Always apply type/ability filter client-side — simple, no special cases.
  // byFilterData is already server-filtered so it's a fast no-op there;
  // byMovesData needs it because by-moves returns all learners regardless of type/ability.
  const filtered = useMemo(() => base.filter(p => {
    if (typeFilters.length > 0 && !typeFilters.every(t => p.types.includes(t))) return false;
    if (abilityFilter) {
      const norm = s => (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const f = norm(abilityFilter);
      const inUsed = p.abilities?.some(a => norm(a.name).includes(f));
      const inAll  = p.allAbilities?.some(a => norm(a).includes(f));
      if (!inUsed && !inAll) return false;
    }
    return true;
  }), [base, typeFilters, abilityFilter]);

  const sortedFiltered = useMemo(
    () => sortPokemon(filtered, sortKey, sortDir),
    [filtered, sortKey, sortDir]
  );

  const [visibleCount, setVisibleCount] = useState(20);
  const prevListRef = useRef(sortedFiltered);
  if (prevListRef.current !== sortedFiltered) {
    prevListRef.current = sortedFiltered;
    if (visibleCount !== 20) setVisibleCount(20);
  }
  const visibleRows = sortedFiltered.slice(0, visibleCount);

  // Only show results when at least one filter is active
  const showResults = hasFilters && !isLoading;

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-.02em' }}>Move lookup</h1>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>
          Filter Pokémon by moves, type, and ability — combine for precise results.
        </p>
      </div>

      {!activeReg?.syncMonth && <NoStatsBanner />}

      {/* ── Move filter ── */}
      <SectionLabel>Moves</SectionLabel>

      {tags.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
          {tags.map(tag => (
            <span key={tag} style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '5px 10px', borderRadius: 8, fontSize: 12,
              fontFamily: 'var(--mono)',
              background: 'var(--accent-dim)', border: '1px solid var(--accent)', color: 'var(--accent)',
            }}>
              {tag}
              <button onClick={() => removeTag(tag)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--accent)', fontSize: 14, lineHeight: 1 }}>×</button>
            </span>
          ))}
          {tags.length > 1 && (
            <button onClick={() => setTags([])} style={{ fontSize: 11, color: 'var(--text-muted)', padding: '4px 8px' }}>Clear all</button>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 10, maxWidth: 480 }}>
        <AutocompleteInput
          value={moveInput}
          onChange={setMoveInput}
          onSelect={addTag}
          onKeyDown={e => { if (e.key === 'Enter') addTag(moveInput); }}
          placeholder={tags.length === 0 ? 'e.g. Tailwind, Fake Out…' : 'Add another move…'}
          fetchSuggestions={q => getMoveSuggestions(q, activeRegId)}
          queryKey={`moves-${activeRegId}`}
        />
        <button className="primary" onClick={() => addTag(moveInput)}>Add</button>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 24 }}>
        {QUICK_MOVES.map(m => {
          const active = tags.some(t => t.toLowerCase() === m.toLowerCase());
          return (
            <button key={m} onClick={() => toggleQuick(m)} style={{
              padding: '5px 12px', fontSize: 12, fontFamily: 'var(--mono)',
              background: active ? 'var(--accent-dim)' : 'var(--bg2)',
              borderColor: active ? 'var(--accent)' : 'var(--border)',
              color: active ? 'var(--accent)' : 'var(--text-secondary)',
            }}>
              {active ? `× ${m}` : m}
            </button>
          );
        })}
      </div>

      {/* ── Type filter ── */}
      <SectionLabel>Type {typeFilters.length > 0 ? `(${typeFilters.length}/2 selected)` : '(up to 2)'}</SectionLabel>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 24 }}>
        {ALL_TYPES.map(type => {
          const active = typeFilters.includes(type);
          const disabled = !active && typeFilters.length >= 2;
          return (
            <button
              key={type}
              onClick={() => !disabled && toggleType(type)}
              style={{
                padding: '5px 12px', fontSize: 12, fontFamily: 'var(--mono)',
                textTransform: 'uppercase', letterSpacing: '.04em',
                color: active ? `var(--t-${type}, #888)` : disabled ? 'var(--text-muted)' : `var(--t-${type}, #888)`,
                background: active ? `var(--t-${type}-bg, rgba(128,128,128,0.15))` : 'var(--bg2)',
                borderColor: active ? `var(--t-${type}, var(--border))` : 'var(--border)',
                opacity: disabled ? 0.4 : 1,
                cursor: disabled ? 'default' : 'pointer',
              }}
            >
              {type}
            </button>
          );
        })}
        {typeFilters.length > 0 && (
          <button onClick={() => setTypeFilters([])} style={{ fontSize: 11, color: 'var(--text-muted)', padding: '4px 8px' }}>
            Clear
          </button>
        )}
      </div>

      {/* ── Ability filter ── */}
      <SectionLabel>Ability</SectionLabel>
      <div style={{ display: 'flex', gap: 8, marginBottom: 28, maxWidth: 480 }}>
        <AutocompleteInput
          value={abilityInput}
          onChange={v => { setAbilityInput(v); if (!v) setAbilityFilter(''); }}
          onSelect={setAbility}
          onKeyDown={e => { if (e.key === 'Enter') setAbility(abilityInput); }}
          placeholder="e.g. Intimidate, Rough Skin…"
          fetchSuggestions={q => getAbilitySuggestions(q, activeRegId)}
          queryKey={`abilities-${activeRegId}`}
        />
        {abilityFilter && (
          <button onClick={clearAbility} style={{ fontSize: 12 }}>Clear</button>
        )}
      </div>

      {/* ── Results ── */}
      {isLoading && hasFilters && <EmptyState icon="⌛" message="Searching…" />}

      {showResults && filtered.length === 0 && (
        <EmptyState icon="◎" message="No Pokémon match the current filters" />
      )}

      {showResults && filtered.length > 0 && (
        <>
          <div style={{ marginBottom: 16, fontSize: 13, color: 'var(--text-secondary)' }}>
            <span className="mono" style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
              {filtered.length}
            </span>
            {' '}Pokémon match
            {tags.length > 0 && <> · moves: <strong>{tags.join(' + ')}</strong></>}
            {typeFilters.length > 0 && <> · type: <strong>{typeFilters.join(' / ')}</strong></>}
            {abilityFilter && <> · ability: <strong>{abilityFilter}</strong></>}
          </div>

          <SortBar sortKey={sortKey} sortDir={sortDir} onSort={handleSort} style={{ marginBottom: 16 }} />

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: visibleCount < sortedFiltered.length ? 8 : 24 }}>
            {visibleRows.map((p, i) => (
              <PokemonRow
                key={p.name}
                name={p.name}
                types={p.types ?? []}
                abilities={p.abilities ?? []}
                stats={p.stats}
                usagePct={p.usagePct}
                rank={i + 1}
                spriteUrl={p.spriteUrl}
                onSelect={goToMeta}
                pokemon={p}
              />
            ))}
          </div>
          {visibleCount < sortedFiltered.length && (
            <button
              onClick={() => setVisibleCount(c => c + 20)}
              style={{ marginBottom: 24, width: '100%' }}
            >
              Show more ({sortedFiltered.length - visibleCount} remaining)
            </button>
          )}
        </>
      )}

      {!hasFilters && !isLoading && (
        <EmptyState icon="⌖" message="Add a move, type, or ability to filter Pokémon" />
      )}
    </div>
  );
}
