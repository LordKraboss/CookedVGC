// src/pages/TournamentTeams.jsx
import { useState, useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getTournaments, getTournamentStandings, getTournamentFormats } from '../lib/api';
import { useTeams } from '../hooks/useTeams';
import {
  FilterBar, TournamentCard, StandingRow, SkeletonCard, SkeletonStanding,
  formatDate, sinceFromPreset, timeAgo,
} from '../components/tournamentBrowser';

// ── Standings panel ───────────────────────────────────────────────────────────
function StandingsPanel({ tournament, onImport }) {
  const [showAll, setShowAll] = useState(false);

  const { data: standings, isLoading, isError } = useQuery({
    queryKey: ['standings', tournament.id],
    queryFn:  () => getTournamentStandings(tournament.id),
    staleTime: 60 * 60_000, // standings are immutable after the event
  });

  // Players who dropped have placing === null — push them to the bottom
  const sorted = !standings ? [] : [
    ...standings.filter(p => p.placing != null).sort((a, b) => a.placing - b.placing),
    ...standings.filter(p => p.placing == null),
  ];
  const displayed = showAll ? sorted : sorted.slice(0, 16);

  return (
    <div>
      {/* Tournament header */}
      <div style={{
        padding: '14px 18px', borderRadius: 12, marginBottom: 14,
        border: '1px solid var(--border)', background: 'var(--bg1)',
      }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 6 }}>
          {tournament.name}
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--mono)' }}>
            {formatDate(tournament.date)}
          </span>
          <span style={{
            fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 4,
            background: 'var(--bg3)', color: 'var(--text-secondary)',
          }}>
            {tournament.players} players
          </span>
          {tournament.format && tournament.format !== 'CUSTOM' && (
            <span style={{
              fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 4,
              background: 'color-mix(in srgb, var(--accent) 14%, transparent)',
              color: 'var(--accent)', border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)',
            }}>
              {tournament.format}
            </span>
          )}
          {standings && (
            <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 'auto' }}>
              {standings.length} players · click a Pokémon to expand
            </span>
          )}
        </div>
      </div>

      {isLoading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {Array.from({ length: 5 }).map((_, i) => <SkeletonStanding key={i} />)}
        </div>
      )}
      {isError && (
        <div style={{ padding: '24px', borderRadius: 12, border: '1px solid var(--border)', fontSize: 13, color: '#f87171', textAlign: 'center' }}>
          Could not load standings.
        </div>
      )}
      {standings?.length === 0 && (
        <div style={{ padding: '24px', borderRadius: 12, border: '1px dashed var(--border)', fontSize: 13, color: 'var(--text-muted)', textAlign: 'center' }}>
          No standings data for this tournament.
        </div>
      )}

      {standings && standings.length > 0 && (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {displayed.map((entry, i) => (
              <StandingRow key={entry.placing ?? i} entry={entry} onImport={(e) => onImport(e, tournament)} />
            ))}
          </div>
          {standings.length > 16 && (
            <button
              onClick={() => setShowAll(v => !v)}
              style={{
                marginTop: 12, width: '100%', padding: '10px',
                borderRadius: 8, border: '1px dashed var(--border)',
                background: 'transparent', cursor: 'pointer',
                fontSize: 12, fontWeight: 600, color: 'var(--text-muted)',
              }}
              onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.borderColor = 'var(--text-muted)'; }}
              onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.borderColor = 'var(--border)'; }}
            >
              {showAll ? `▲ Show top 16 only` : `▼ Show all ${standings.length} players`}
            </button>
          )}
        </>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
const DEFAULT_FILTERS = { minPlayers: 0, format: '', source: '', datePreset: '14d' };
const PAGE_SIZE = 10;

export default function TournamentTeams() {
  const [selectedId, setSelectedId]   = useState(null);
  const [filters, setFilters]         = useState(DEFAULT_FILTERS);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const { newTeam } = useTeams();

  // Reset pagination whenever filters change
  const updateFilters = useCallback((updater) => {
    setFilters(updater);
    setVisibleCount(PAGE_SIZE);
  }, []);

  // Formats list for the dropdown (changes rarely)
  const { data: formats } = useQuery({
    queryKey: ['tournament-formats'],
    queryFn:  getTournamentFormats,
    staleTime: 30 * 60_000,
  });

  // Tournament list from DB
  const tournamentsQuery = useQuery({
    queryKey: ['tournaments-vgc', filters.minPlayers, filters.format, filters.source, filters.datePreset],
    queryFn:  () => getTournaments({
      limit: 500,
      minPlayers: filters.minPlayers,
      format:     filters.format,
      source:     filters.source,
      since:      sinceFromPreset(filters.datePreset),
    }),
    staleTime: 5 * 60_000,
  });
  const { data: tourData, isLoading, isError } = tournamentsQuery;
  const tournaments = tourData?.tournaments ?? [];
  const dbTotal     = tourData?.total       ?? 0;
  const lastSync    = tourData?.lastSync     ?? null;

  const selectedTournament = useMemo(
    () => tournaments.find(t => t.id === selectedId) ?? null,
    [tournaments, selectedId],
  );

  const buildSlot = useCallback((pk) => ({
    name:      pk.name,
    types:     [],
    spriteUrl: null,
    nature:    pk.statAlignment ?? null,
    evs:       { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    moves:     pk.moves   ?? [],
    item:      pk.item    ?? '',
    ability:   pk.ability ?? '',
    teraType:  pk.teraType ?? null,
  }), []);

  const handleImport = useCallback((entry, tournament) => {
    if (!Array.isArray(entry.team) || entry.team.length === 0) return;
    const slots = [
      ...entry.team.slice(0, 6).map(buildSlot),
      ...Array(Math.max(0, 6 - entry.team.length)).fill(null),
    ];
    newTeam(slots, `${tournament.name} — ${entry.name}`);
  }, [buildSlot, newTeam]);

  const infoRight = (
    <>
      {dbTotal > 0 ? (
        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{dbTotal} total · updated {timeAgo(lastSync)}</span>
      ) : (
        <span style={{ fontSize: 10, color: '#f87171' }}>No tournaments cached yet</span>
      )}
      <span style={{ fontSize: 10, color: 'var(--text-muted)', opacity: .6 }}>Auto-syncs daily at 00:05 UTC</span>
    </>
  );

  return (
    <div style={{ maxWidth: 1260, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, marginBottom: 4 }}>Tournament Teams</h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          VGC event results · powered by{' '}
          <a href="https://play.limitlesstcg.com" target="_blank" rel="noreferrer"
            style={{ color: 'var(--accent)', textDecoration: 'none' }}>
            Limitless TCG
          </a>
        </p>
      </div>

      {/* Filters + Sync */}
      <FilterBar filters={filters} setFilters={updateFilters} formats={formats} infoRight={infoRight} />

      <div className="flex-col-mobile" style={{ display: 'flex', gap: 18, alignItems: 'flex-start' }}>

        {/* ── Tournament list ── */}
        <div style={{ width: 290, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 7 }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.08em', color: 'var(--text-muted)', marginBottom: 3 }}>
            EVENTS {tournaments.length > 0 ? `· ${tournaments.length}` : ''}
          </div>

          {isLoading && Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)}

          {isError && (
            <div style={{ padding: '20px', borderRadius: 10, border: '1px solid var(--border)', fontSize: 13, color: '#f87171', textAlign: 'center' }}>
              Could not load tournaments.
            </div>
          )}

          {!isLoading && !isError && tournaments.length === 0 && (
            <div style={{ padding: '20px', borderRadius: 10, border: '1px dashed var(--border)', fontSize: 13, color: 'var(--text-muted)', textAlign: 'center' }}>
              {dbTotal === 0
                ? 'No tournaments cached yet — data syncs automatically at 00:05 UTC.'
                : 'No tournaments match the current filters.'}
            </div>
          )}

          {tournaments.slice(0, visibleCount).map(t => (
            <TournamentCard
              key={t.id}
              tournament={t}
              selected={t.id === selectedId}
              onClick={() => setSelectedId(id => id === t.id ? null : t.id)}
            />
          ))}

          {/* Pagination — "Show X more" */}
          {tournaments.length > visibleCount && (
            <button
              onClick={() => setVisibleCount(n => n + PAGE_SIZE)}
              style={{
                marginTop: 4, width: '100%', padding: '10px',
                borderRadius: 8, border: '1px dashed var(--border)',
                background: 'transparent', cursor: 'pointer',
                fontSize: 12, fontWeight: 600, color: 'var(--text-muted)',
                fontFamily: 'inherit',
              }}
              onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.borderColor = 'var(--text-muted)'; }}
              onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.borderColor = 'var(--border)'; }}
            >
              ▼ Show {Math.min(PAGE_SIZE, tournaments.length - visibleCount)} more
              <span style={{ opacity: .6, marginLeft: 4 }}>
                ({tournaments.length - visibleCount} remaining)
              </span>
            </button>
          )}
        </div>

        {/* ── Detail panel ── */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {!selectedTournament ? (
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              justifyContent: 'center', padding: '80px 20px',
              borderRadius: 12, border: '1px dashed var(--border)',
              color: 'var(--text-muted)', fontSize: 13, gap: 12,
            }}>
              <span style={{ fontSize: 32 }}>◈</span>
              <span style={{ fontWeight: 600 }}>Select a tournament to view top teams</span>
              <span style={{ fontSize: 12, opacity: .7 }}>Click any event on the left</span>
            </div>
          ) : (
            <StandingsPanel
              key={selectedTournament.id}
              tournament={selectedTournament}
              onImport={handleImport}
            />
          )}
        </div>

      </div>
    </div>
  );
}
