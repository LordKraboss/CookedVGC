// src/pages/TournamentResults.jsx
// Archive of our OWN completed tournaments — same browse experience as the
// Tournament Teams page (filter bar + event sidebar + expandable team cards +
// import), powered by /tourney/results instead of the RK9/Limitless cache.
import { useState, useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { tourneyResults, tourneyResult } from '../lib/api';
import { useTeams } from '../hooks/useTeams';
import {
  FilterBar, TournamentCard, StandingRow, SkeletonCard, SkeletonStanding,
  formatDate, sinceFromPreset,
} from '../components/tournamentBrowser';

const FORMAT_LABEL = {
  round_robin: 'Round Robin', swiss: 'Swiss', playoff: 'Playoff', swiss_playoff: 'Swiss + Playoff',
};

// chip shape expected by PokemonChip (nature → statAlignment line)
const toChip = (pk) => ({
  name: pk.name, item: pk.item, ability: pk.ability,
  moves: pk.moves, teraType: pk.teraType ?? null,
  statAlignment: pk.statAlignment ?? pk.nature ?? null,
});

// ── Detail panel (one completed event) ─────────────────────────────────────────
function ResultPanel({ code, onImport }) {
  const { data: t, isLoading, isError } = useQuery({
    queryKey: ['tourney-result', code],
    queryFn: () => tourneyResult(code),
    staleTime: 60 * 60_000, // archived events are immutable
  });

  const entries = useMemo(() => {
    if (!t) return [];
    const partBy = Object.fromEntries(t.participants.map(p => [p.clientId, p]));
    return t.finalStandings.map(r => ({
      placing: r.rank,
      name: r.name,
      record: r.wins != null ? { wins: r.wins, losses: r.losses, ties: 0 } : null,
      team: (partBy[r.clientId]?.team || []).map(toChip),
    }));
  }, [t]);

  if (isLoading) return <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{Array.from({ length: 5 }).map((_, i) => <SkeletonStanding key={i} />)}</div>;
  if (isError || !t) return <div style={{ padding: 24, borderRadius: 12, border: '1px solid var(--border)', fontSize: 13, color: '#f87171', textAlign: 'center' }}>Could not load this tournament.</div>;

  return (
    <div>
      <div style={{ padding: '14px 18px', borderRadius: 12, marginBottom: 14, border: '1px solid var(--border)', background: 'var(--bg1)' }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 6 }}>{t.name}</div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--mono)' }}>{formatDate(t.completedAt)}</span>
          <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 4, background: 'var(--bg3)', color: 'var(--text-secondary)' }}>{t.participants.length} players</span>
          <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 4, background: 'color-mix(in srgb, var(--accent) 14%, transparent)', color: 'var(--accent)', border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)' }}>
            {FORMAT_LABEL[t.format] ?? t.format}
          </span>
          <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 4, background: 'var(--bg3)', color: 'var(--text-secondary)' }}>{t.regId}</span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 'auto' }}>teamsheet {t.config?.teamsheet} · click a Pokémon to expand</span>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {entries.map((entry, i) => (
          <StandingRow key={entry.placing ?? i} entry={entry} onImport={(e) => onImport(e, t)} />
        ))}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
const DEFAULT_FILTERS = { minPlayers: 0, format: '', source: '', datePreset: 'all' };
const PAGE_SIZE = 12;

export default function TournamentResults() {
  const [selectedCode, setSelectedCode] = useState(null);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const { newTeam } = useTeams();

  const updateFilters = useCallback((updater) => {
    setFilters(updater);
    setVisibleCount(PAGE_SIZE);
  }, []);

  const { data: list = [], isLoading, isError } = useQuery({
    queryKey: ['tourney-results'],
    queryFn: tourneyResults,
    staleTime: 30_000,
  });

  // regulation options from what's actually in the archive
  const regOptions = useMemo(() => [...new Set(list.map(t => t.reg_id).filter(Boolean))].sort(), [list]);

  // client-side filtering (the archive is small)
  const filtered = useMemo(() => {
    const since = sinceFromPreset(filters.datePreset);
    return list.filter(t =>
      (!since || (t.completed_at && t.completed_at >= since)) &&
      (!filters.format || t.reg_id === filters.format) &&
      (t.players ?? 0) >= filters.minPlayers
    );
  }, [list, filters]);

  // adapt our rows → the shared TournamentCard shape
  const cards = useMemo(() => filtered.map(t => ({
    id: t.code, name: t.name, date: t.completed_at, players: t.players,
    format: t.reg_id, hasLists: true, source: 'local',
  })), [filtered]);

  const buildSlot = useCallback((pk) => ({
    name: pk.name, types: [], spriteUrl: null,
    nature: pk.statAlignment ?? null,
    evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    moves: pk.moves ?? [], item: pk.item ?? '', ability: pk.ability ?? '', teraType: pk.teraType ?? null,
  }), []);

  const handleImport = useCallback((entry, t) => {
    if (!Array.isArray(entry.team) || entry.team.length === 0) return;
    const slots = [
      ...entry.team.slice(0, 6).map(buildSlot),
      ...Array(Math.max(0, 6 - entry.team.length)).fill(null),
    ];
    newTeam(slots, `${t.name} — ${entry.name}`);
  }, [buildSlot, newTeam]);

  const infoRight = <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{list.length} tournament{list.length === 1 ? '' : 's'} archived</span>;

  return (
    <div style={{ maxWidth: 1260, margin: '0 auto' }}>
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, marginBottom: 4 }}>🏆 Tournament Results</h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Your own completed tournaments — final standings, every team, importable.</p>
      </div>

      <FilterBar filters={filters} setFilters={updateFilters} formats={regOptions} showSource={false} infoRight={infoRight} />

      <div className="flex-col-mobile" style={{ display: 'flex', gap: 18, alignItems: 'flex-start' }}>
        {/* event list */}
        <div style={{ width: 290, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 7 }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.08em', color: 'var(--text-muted)', marginBottom: 3 }}>
            EVENTS {cards.length > 0 ? `· ${cards.length}` : ''}
          </div>

          {isLoading && Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
          {isError && <div style={{ padding: 20, borderRadius: 10, border: '1px solid var(--border)', fontSize: 13, color: '#f87171', textAlign: 'center' }}>Could not load results.</div>}
          {!isLoading && !isError && cards.length === 0 && (
            <div style={{ padding: 20, borderRadius: 10, border: '1px dashed var(--border)', fontSize: 13, color: 'var(--text-muted)', textAlign: 'center' }}>
              {list.length === 0 ? 'No completed tournaments yet — run one in the Tournament tab.' : 'No tournaments match the current filters.'}
            </div>
          )}

          {cards.slice(0, visibleCount).map(c => (
            <TournamentCard key={c.id} tournament={c} selected={c.id === selectedCode}
              onClick={() => setSelectedCode(id => id === c.id ? null : c.id)} />
          ))}

          {cards.length > visibleCount && (
            <button onClick={() => setVisibleCount(n => n + PAGE_SIZE)}
              style={{ marginTop: 4, width: '100%', padding: 10, borderRadius: 8, border: '1px dashed var(--border)', background: 'transparent', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', fontFamily: 'inherit' }}>
              ▼ Show {Math.min(PAGE_SIZE, cards.length - visibleCount)} more
            </button>
          )}
        </div>

        {/* detail */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {!selectedCode ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '80px 20px', borderRadius: 12, border: '1px dashed var(--border)', color: 'var(--text-muted)', fontSize: 13, gap: 12 }}>
              <span style={{ fontSize: 32 }}>🏆</span>
              <span style={{ fontWeight: 600 }}>Select a tournament to view results</span>
              <span style={{ fontSize: 12, opacity: .7 }}>Click any event on the left</span>
            </div>
          ) : (
            <ResultPanel key={selectedCode} code={selectedCode} onImport={handleImport} />
          )}
        </div>
      </div>
    </div>
  );
}
