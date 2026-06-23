// src/pages/UsageRanking.jsx
import { useState, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { getUsage } from '../lib/api';
import { useRegulation } from '../lib/RegulationContext';
import { PokemonRow, EmptyState } from '../components/PokemonCard';
import { SortBar, sortPokemon, usePokemonSort } from '../components/SortBar';

export default function UsageRanking() {
  const { activeRegId, activeReg } = useRegulation();
  const [search, setSearch] = useState('');
  const { sortKey, sortDir, handleSort } = usePokemonSort('usage');
  const navigate = useNavigate();

  const { data: pokemon = [], isLoading, error } = useQuery({
    queryKey: ['usage', activeRegId],
    queryFn: () => getUsage(activeRegId, 150),
    enabled: !!activeRegId,
  });

  const filtered = search
    ? pokemon.filter(p => p.name.toLowerCase().includes(search.toLowerCase()))
    : pokemon;

  const sorted = sortPokemon(filtered, sortKey, sortDir);

  const [visibleCount, setVisibleCount] = useState(20);
  const prevSortedRef = useRef(sorted);
  if (prevSortedRef.current !== sorted) {
    prevSortedRef.current = sorted;
    if (visibleCount !== 20) setVisibleCount(20);
  }
  const visibleRows = sorted.slice(0, visibleCount);

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-.02em' }}>Usage Rankings</h1>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>
          {activeReg?.label} · {activeReg?.syncMonth ?? '—'} ·{' '}
          <span className="mono">{pokemon.length} Pokémon tracked</span>
        </p>
      </div>

      {/* Search */}
      <div style={{ marginBottom: 12, maxWidth: 360 }}>
        <input
          placeholder="Filter Pokémon…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      <SortBar sortKey={sortKey} sortDir={sortDir} onSort={handleSort} style={{ marginBottom: 16 }} />

      {/* List */}
      {isLoading && <EmptyState icon="⌛" message="Loading usage data…" />}
      {error    && <EmptyState icon="⚠"  message={`Failed to load: ${error.message}`} />}
      {!isLoading && !error && sorted.length === 0 && (
        <EmptyState icon="◎" message="No Pokémon found" />
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {visibleRows.map((p, i) => (
          <PokemonRow
            key={p.name}
            name={p.name}
            types={p.types}
            abilities={p.abilities ?? []}
            stats={p.stats}
            usagePct={p.usagePct}
            rank={i + 1}
            spriteUrl={p.spriteUrl}
            onClick={() => navigate(`/meta?q=${encodeURIComponent(p.name)}`)}
          />
        ))}
      </div>
      {visibleCount < sorted.length && (
        <button
          onClick={() => setVisibleCount(c => c + 20)}
          style={{ marginTop: 12, width: '100%' }}
        >
          Show more ({sorted.length - visibleCount} remaining)
        </button>
      )}
    </div>
  );
}
