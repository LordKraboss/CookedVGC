// src/pages/MetaAnalysis.jsx
import { useQuery } from '@tanstack/react-query';
import { useState, useRef, useMemo, useTransition, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { getPokemonMeta, getUsage } from '../lib/api';
import { useRegulation } from '../lib/RegulationContext';
import { SortBar, sortPokemon, usePokemonSort } from '../components/SortBar';
import {
  PokemonImage, PokemonRow, TypePill, StatRow, UsageBar,
  SectionLabel, EmptyState,
} from '../components/PokemonCard';
import { AddToTeamButton } from '../components/AddToTeamButton';
import { MovePool } from '../components/MovePool';
import NoStatsBanner from '../components/NoStatsBanner';
import { getTypeMatchups, multLabel } from '../lib/typeChart';

const matchupColor = m =>
  m >= 4 ? '#ef4444' : m > 1 ? '#f87171' : m === 0 ? '#94a3b8' : m <= 0.25 ? '#4ade80' : '#86efac';

function MatchupGroup({ label, items }) {
  if (!items.length) return null;
  // Pack by multiplier: all 4× together, all 2× together, etc. (input is pre-sorted by severity)
  const packs = [];
  for (const it of items) {
    const last = packs[packs.length - 1];
    if (last && last.mult === it.mult) last.types.push(it.type);
    else packs.push({ mult: it.mult, types: [it.type] });
  }
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.08em', color: 'var(--text-muted)', marginBottom: 8, fontFamily: 'var(--mono)' }}>
        {label}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {packs.map(pack => (
          <div key={pack.mult} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="mono" style={{ fontSize: 12, fontWeight: 700, width: 34, flexShrink: 0, color: matchupColor(pack.mult) }}>
              {multLabel(pack.mult)}
            </span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {pack.types.map(type => <TypePill key={type} type={type} />)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TypeMatchups({ types }) {
  const { weak, resist } = getTypeMatchups(types ?? []);
  return (
    <div className="card">
      <SectionLabel>Weaknesses / Resistances</SectionLabel>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <MatchupGroup label="Weak to" items={weak} />
        <MatchupGroup label="Resists" items={resist} />
        {weak.length === 0 && resist.length === 0 && (
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Neutral to all types.</span>
        )}
      </div>
    </div>
  );
}

function MoveRow({ move, pct }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
      <span style={{
        fontSize: 13, fontWeight: 600,
        width: 148, flexShrink: 0,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>
        {move}
      </span>
      {/* minWidth:0 prevents the bar from overflowing the flex container */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <UsageBar pct={pct} />
      </div>
      <span className="mono" style={{ fontSize: 12, color: 'var(--text-secondary)', width: 44, textAlign: 'right', flexShrink: 0 }}>
        {pct.toFixed(1)}%
      </span>
    </div>
  );
}

function SpreadRow({ spread, index }) {
  const { nature, evs, pct } = spread;
  const evStr = evs
    ? Object.entries(evs).filter(([, v]) => v > 0)
        .map(([k, v]) => `${v} ${k.toUpperCase()}`).join(' / ')
    : '—';
  return (
    <div style={{
      padding: '10px 14px', borderRadius: 10, marginBottom: 6,
      background: index === 0 ? 'var(--accent-dim)' : 'var(--bg2)',
      border: `1px solid ${index === 0 ? 'var(--accent)' : 'var(--border)'}`,
      display: 'flex', alignItems: 'center', gap: 12,
    }}>
      {index === 0 && (
        <span className="mono" style={{ fontSize: 10, color: 'var(--accent)', background: 'var(--accent-dim)', padding: '2px 6px', borderRadius: 4 }}>
          TOP
        </span>
      )}
      <div style={{ flex: 1 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{nature} </span>
        <span className="mono" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{evStr}</span>
      </div>
      <span className="mono" style={{ fontSize: 12, color: 'var(--text-muted)' }}>{pct.toFixed(1)}%</span>
    </div>
  );
}

function formatUpdated(value) {
  if (!value) return null;
  // last_synced is a UTC datetime string (e.g. "2025-05-22 10:30:00").
  const d = new Date(value.includes('T') ? value : value.replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
}

export default function MetaAnalysis() {
  const { activeRegId, activeReg } = useRegulation();
  const updatedOn = formatUpdated(activeReg?.lastSynced);
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [submitted, setSubmitted] = useState(searchParams.get('q') ?? '');
  const [search, setSearch] = useState('');
  const { sortKey, sortDir, handleSort } = usePokemonSort('usage');
  const [, startTransition] = useTransition();
  // true when the page was loaded directly with ?q= (came from another page or shared URL)
  const fromUrl = useRef(!!searchParams.get('q'));


  const { data: usageList = [], isLoading: usageLoading } = useQuery({
    queryKey: ['usage', activeRegId],
    queryFn: () => getUsage(activeRegId),
    enabled: !!activeRegId,
  });

  const { data, isLoading: metaLoading, error } = useQuery({
    queryKey: ['meta', submitted, activeRegId],
    queryFn: () => getPokemonMeta(submitted, activeRegId),
    enabled: !!submitted && !!activeRegId,
  });

  // Display names are now embedded in the enriched meta response — no extra calls needed.

  const submit = useCallback((val) => {
    const v = (val ?? '').trim();
    if (!v) return;
    fromUrl.current = false;
    startTransition(() => {
      setSubmitted(v);
      setSearchParams({ q: v }, { replace: false });
    });
  }, [setSearchParams, startTransition]);

  const back = useCallback(() => {
    if (fromUrl.current) {
      navigate(-1);
    } else {
      startTransition(() => {
        setSubmitted('');
        setSearchParams({}, { replace: false });
      });
    }
  }, [navigate, setSearchParams, startTransition]);

  const filtered = useMemo(
    () => search
      ? usageList.filter(p => p.name.toLowerCase().includes(search.toLowerCase()))
      : usageList,
    [search, usageList]
  );

  const sorted = useMemo(
    () => sortPokemon(filtered, sortKey, sortDir),
    [filtered, sortKey, sortDir]
  );

  // Reset visible count whenever the list or sort changes
  const [visibleCount, setVisibleCount] = useState(20);
  const prevSortedRef = useRef(sorted);
  if (prevSortedRef.current !== sorted) {
    prevSortedRef.current = sorted;
    if (visibleCount !== 20) setVisibleCount(20);
  }
  const visibleRows = sorted.slice(0, visibleCount);

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
          <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-.02em' }}>Meta analysis</h1>
          {updatedOn && (
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Updated {updatedOn}
            </span>
          )}
        </div>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>
          Most-used moveset, EV spreads, items, and teammates from Smogon usage stats.
        </p>
      </div>

      {/* ── Detail view ── */}
      {submitted && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
            <button
              onClick={back}
              style={{ fontSize: 12, color: 'var(--text-secondary)', padding: '5px 12px' }}
            >
              ← Back to list
            </button>
            {data && (
              <AddToTeamButton
                pokemon={{ name: data.name, types: data.types, spriteUrl: data.spriteUrl, usagePct: data.usagePct }}
              />
            )}
          </div>

          {metaLoading && <EmptyState icon="⌛" message={`Loading meta for ${submitted}…`} />}
          {error       && <EmptyState icon="⚠"  message={`Not found: ${error.message}`} />}

          {data && (
            <>
            {/* Each row is a direct grid child — CSS stretch makes cells in a row equal height */}
            <div className="stack-mobile" style={{ display: 'grid', gridTemplateColumns: '300px 1fr 1fr', gap: 20 }}>

              {/* ── Row 1: Portrait | Moveset | Abilities ── */}
              <div className="card" style={{ textAlign: 'center' }}>
                <PokemonImage name={data.name} size={140} spriteUrl={data.spriteUrl} shadow style={{ margin: '0 auto 12px' }} />
                <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 8 }}>{data.name}</div>
                <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginBottom: 12 }}>
                  {data.types.map(t => <TypePill key={t} type={t} />)}
                </div>
                <div className="mono" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  Usage: <strong style={{ color: 'var(--text-primary)' }}>{data.usagePct?.toFixed(1)}%</strong>
                  {' '}· {data.regulation?.month}
                </div>
              </div>

              <div className="card">
                <SectionLabel>Moveset — by usage</SectionLabel>
                {data.moves?.map(m => (
                  <MoveRow key={m.name} move={m.displayName ?? m.name} pct={m.pct} />
                ))}
              </div>

              <div className="card">
                <SectionLabel>Abilities</SectionLabel>
                {data.abilities?.slice(0, 4).map(ab => (
                  <div key={ab.name} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <span style={{ fontSize: 13, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {ab.displayName ?? ab.name}
                    </span>
                    <span className="mono" style={{ fontSize: 12, color: 'var(--text-secondary)', flexShrink: 0, width: 44, textAlign: 'right' }}>
                      {ab.pct.toFixed(1)}%
                    </span>
                  </div>
                ))}
              </div>

              {/* ── Row 2: Base Stats | Weaknesses/Resistances | Items ── */}
              <div className="card">
                <SectionLabel>Base stats</SectionLabel>
                {data.stats && Object.entries(data.stats).map(([k, v]) => (
                  <StatRow key={k} label={k} value={v} />
                ))}
              </div>

              <TypeMatchups types={data.types} />

              <div className="card">
                <SectionLabel>Items</SectionLabel>
                {data.items?.slice(0, 6).map(it => (
                  <div key={it.name} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <span style={{ fontSize: 13, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {it.displayName ?? it.name}
                    </span>
                    <span className="mono" style={{ fontSize: 12, color: 'var(--text-secondary)', flexShrink: 0, width: 44, textAlign: 'right' }}>
                      {it.pct.toFixed(1)}%
                    </span>
                  </div>
                ))}
              </div>

              {/* ── Row 3: EV Spreads | Common Teammates — spans full width, equal size ── */}
              <div className="stack-mobile" style={{
                gridColumn: '1 / -1',
                display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20,
              }}>
                <div className="card">
                  <SectionLabel>EV spreads — top used</SectionLabel>
                  {data.spreads?.slice(0, 10).map((s, i) => (
                    <SpreadRow key={i} spread={s} index={i} />
                  ))}
                </div>
                <div className="card">
                  <SectionLabel>Common teammates</SectionLabel>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {data.teammates?.slice(0, 10).map(t => (
                      <div key={t.name} style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '8px 12px', background: 'var(--bg2)',
                        borderRadius: 8, border: '1px solid var(--border)',
                      }}>
                        <PokemonImage name={t.name} size={32} spriteUrl={t.spriteUrl} />
                        <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>{t.name}</span>
                        <span className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>
                          {data.rawCount ? ((t.score / data.rawCount) * 100).toFixed(1) : '—'}%
                        </span>
                        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                          <button onClick={() => submit(t.name)} style={{ padding: '5px 10px', fontSize: 12 }}>View</button>
                          <AddToTeamButton pokemon={{ name: t.name, types: [], spriteUrl: t.spriteUrl, usagePct: null }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

            </div>

            {/* Full move pool — spans below the grid */}
            <MovePool pokemonName={data.name} regId={activeRegId} />
            </>
          )}
        </>
      )}

      {/* ── List view ── */}
      {!submitted && (
        <>
          {!activeReg?.syncMonth && (
            <NoStatsBanner>
              No usage stats for this regulation yet — Showdown hasn't published data for it.
              Showing the full roster at <strong style={{ color: 'var(--text-primary)' }}>0% usage</strong> until stats are available.
            </NoStatsBanner>
          )}

          <div style={{ marginBottom: 12, maxWidth: 360 }}>
            <input
              placeholder="Filter Pokémon…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          <SortBar sortKey={sortKey} sortDir={sortDir} onSort={handleSort} style={{ marginBottom: 16 }} />

          {usageLoading && <EmptyState icon="⌛" message="Loading…" />}
          {!usageLoading && sorted.length === 0 && (
            <EmptyState icon="📭" message="No roster data available yet for this regulation." />
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
                onSelect={submit}
                pokemon={p}
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
        </>
      )}
    </div>
  );
}
