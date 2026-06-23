// components/tournamentBrowser.jsx
// Shared presentational pieces for browsing tournaments + their team lists.
// Used by both the RK9/Limitless "Tournament Teams" page and our own
// "Tournament Results" archive, so the two look and behave identically.
import { useState } from 'react';
import { PokemonChip } from './PokemonChip';

// ── Date presets ────────────────────────────────────────────────────────────────
export const DATE_PRESETS = [
  { key: '1d',    label: 'Yesterday' },
  { key: '7d',    label: 'Last 7 days' },
  { key: '14d',   label: 'Last 14 days' },
  { key: '30d',   label: 'Last 30 days' },
  { key: '90d',   label: 'Last 90 days' },
  { key: '180d',  label: 'Last 180 days' },
  { key: '365d',  label: 'Last year' },
  { key: 'all',   label: 'All time' },
];

export function sinceFromPreset(key) {
  if (!key || key === 'all') return '';
  const days = parseInt(key);
  if (!days) return '';
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatRecord(record) {
  if (!record) return null;
  if (typeof record === 'string') return record;
  const { wins = 0, losses = 0, ties = 0 } = record;
  return ties > 0 ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`;
}

export function placingLabel(n) {
  if (!n) return '—';
  if (n === 1) return '🥇';
  if (n === 2) return '🥈';
  if (n === 3) return '🥉';
  return `#${n}`;
}

export function timeAgo(iso) {
  if (!iso) return null;
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 2)   return 'just now';
  if (mins < 60)  return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)   return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

// ── Filter bar ────────────────────────────────────────────────────────────────
// `regLabel` lets callers say "REGULATION" vs anything else; `showSource` toggles
// the RK9/Limitless source row; `infoRight` is a custom corner node.
export function FilterBar({ filters, setFilters, formats, showSource = true, infoRight = null, regLabel = 'REGULATION' }) {
  const inputStyle = {
    background: 'var(--bg2)', border: '1px solid var(--border)',
    borderRadius: 6, color: 'var(--text-primary)', fontSize: 12,
    padding: '6px 10px', fontFamily: 'inherit', outline: 'none',
  };
  const labelStyle = { fontSize: 10, fontWeight: 700, letterSpacing: '.06em', color: 'var(--text-muted)' };

  const chipStyle = (active) => ({
    fontSize: 11, fontWeight: 700, padding: '5px 10px', borderRadius: 6,
    cursor: 'pointer', whiteSpace: 'nowrap',
    border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
    background: active ? 'color-mix(in srgb, var(--accent) 14%, transparent)' : 'var(--bg2)',
    color: active ? 'var(--accent)' : 'var(--text-muted)',
  });

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 10,
      padding: '12px 16px', borderRadius: 10,
      border: '1px solid var(--border)', background: 'var(--bg1)',
      marginBottom: 14,
    }}>
      {/* Row 1: date + info */}
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={labelStyle}>PERIOD</span>
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            {DATE_PRESETS.map(({ key, label }) => (
              <button key={key} onClick={() => setFilters(f => ({ ...f, datePreset: key }))}
                style={chipStyle(filters.datePreset === key)}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div style={{ flex: 1 }} />
        {infoRight && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-end' }}>
            {infoRight}
          </div>
        )}
      </div>

      {/* Row 2: regulation + min players + source */}
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={labelStyle}>{regLabel}</span>
          <select value={filters.format} onChange={e => setFilters(f => ({ ...f, format: e.target.value }))}
            style={{ ...inputStyle, minWidth: 120 }}>
            <option value="">All</option>
            {(formats ?? []).map(fmt => <option key={fmt} value={fmt}>{fmt}</option>)}
          </select>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={labelStyle}>MIN PLAYERS</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <input type="number" min={0} max={2000} step={8}
              value={filters.minPlayers}
              onChange={e => setFilters(f => ({ ...f, minPlayers: Math.max(0, parseInt(e.target.value) || 0) }))}
              style={{ ...inputStyle, width: 68 }} />
            {[0, 32, 64, 128, 256].map(v => (
              <button key={v} onClick={() => setFilters(f => ({ ...f, minPlayers: v }))}
                style={{ ...chipStyle(filters.minPlayers === v), padding: '4px 7px', fontSize: 10 }}>
                {v === 0 ? 'All' : `${v}+`}
              </button>
            ))}
          </div>
        </div>

        {showSource && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={labelStyle}>SOURCE</span>
            <div style={{ display: 'flex', gap: 5 }}>
              {[{ val: '', label: 'All' }, { val: 'limitless', label: 'Limitless' }, { val: 'rk9', label: 'RK9' }]
                .map(({ val, label }) => (
                  <button key={val} onClick={() => setFilters(f => ({ ...f, source: val }))}
                    style={chipStyle(filters.source === val)}>
                    {label}
                  </button>
                ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Tournament card (event list item) ─────────────────────────────────────────
const SOURCE_STYLE = {
  limitless: { color: 'var(--accent)', bg: 'color-mix(in srgb, var(--accent) 14%, transparent)', border: 'color-mix(in srgb, var(--accent) 30%, transparent)', label: 'Limitless' },
  rk9:       { color: '#f97316',        bg: 'color-mix(in srgb, #f97316 14%, transparent)',        border: 'color-mix(in srgb, #f97316 30%, transparent)',        label: 'RK9' },
  local:     { color: '#34d399',        bg: 'color-mix(in srgb, #34d399 14%, transparent)',        border: 'color-mix(in srgb, #34d399 30%, transparent)',        label: 'Mine' },
};

export function TournamentCard({ tournament, selected, onClick }) {
  const { name, date, players, format, hasLists, source } = tournament;
  const src = SOURCE_STYLE[source] ?? SOURCE_STYLE.limitless;

  return (
    <div
      onClick={onClick}
      style={{
        padding: '12px 14px', borderRadius: 10,
        border: `1px solid ${selected ? 'var(--accent)' : 'var(--border)'}`,
        background: selected ? 'color-mix(in srgb, var(--accent) 8%, var(--bg1))' : 'var(--bg1)',
        cursor: 'pointer', transition: 'border-color .15s, background .15s',
        borderLeft: selected ? '3px solid var(--accent)' : '3px solid transparent',
      }}
      onMouseEnter={e => { if (!selected) e.currentTarget.style.borderColor = 'var(--text-muted)'; }}
      onMouseLeave={e => { if (!selected) e.currentTarget.style.borderColor = 'var(--border)'; }}
    >
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 5, lineHeight: 1.3 }}>
        {name}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--mono)' }}>{formatDate(date)}</span>
        <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 4, background: 'var(--bg3)', color: 'var(--text-secondary)' }}>{players}p</span>
        {format && format !== 'CUSTOM' && (
          <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 4, background: 'var(--bg3)', color: 'var(--text-secondary)' }}>{format}</span>
        )}
        <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 4, background: src.bg, color: src.color, border: `1px solid ${src.border}` }}>{src.label}</span>
        {!hasLists && <span style={{ fontSize: 9, color: '#f87171', fontStyle: 'italic' }}>no lists</span>}
      </div>
    </div>
  );
}

// ── Skeletons ─────────────────────────────────────────────────────────────────
export function SkeletonCard() {
  return (
    <div style={{ padding: '12px 14px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg1)' }}>
      <div style={{ height: 13, width: '78%', borderRadius: 4, background: 'var(--bg3)', marginBottom: 8 }} />
      <div style={{ display: 'flex', gap: 6 }}>
        <div style={{ height: 10, width: 72, borderRadius: 4, background: 'var(--bg3)' }} />
        <div style={{ height: 10, width: 48, borderRadius: 4, background: 'var(--bg3)' }} />
      </div>
    </div>
  );
}

export function SkeletonStanding() {
  return (
    <div style={{ padding: '16px 20px', borderRadius: 12, border: '1px solid var(--border)', background: 'var(--bg1)' }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 14 }}>
        <div style={{ height: 28, width: 44, borderRadius: 6, background: 'var(--bg3)' }} />
        <div style={{ height: 14, width: 140, borderRadius: 4, background: 'var(--bg3)' }} />
        <div style={{ height: 12, width: 60, borderRadius: 4, background: 'var(--bg3)' }} />
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} style={{ height: 70, width: 90, borderRadius: 8, background: 'var(--bg3)', flexShrink: 0 }} />
        ))}
      </div>
    </div>
  );
}

// ── Standing row (placing + record + expandable team) ─────────────────────────
// `onImport(entry)` is optional; the Import button only shows when it's provided
// AND the entry has a team.
export function StandingRow({ entry, onImport }) {
  const [expanded, setExpanded] = useState(false);
  const [justImported, setJustImported] = useState(false);

  const record  = formatRecord(entry.record);
  const hasTeam = Array.isArray(entry.team) && entry.team.length > 0;

  const handleImport = () => {
    onImport?.(entry);
    setJustImported(true);
    setTimeout(() => setJustImported(false), 2000);
  };

  return (
    <div style={{
      padding: '14px 18px', borderRadius: 12,
      border: '1px solid var(--border)', background: 'var(--bg1)',
      opacity: entry.placing == null ? 0.45 : 1,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: hasTeam ? 12 : 0, flexWrap: 'wrap' }}>
        <span style={{
          fontSize: entry.placing && entry.placing <= 3 ? 20 : 12, fontWeight: 800,
          fontFamily: entry.placing && entry.placing <= 3 ? undefined : 'var(--mono)',
          color: entry.placing && entry.placing <= 3 ? undefined : 'var(--text-muted)', minWidth: 30,
        }}>
          {placingLabel(entry.placing)}
        </span>
        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', flex: 1 }}>
          {entry.name}
          {entry.country && <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400, marginLeft: 6 }}>{entry.country}</span>}
        </span>
        {record && (
          <span style={{ fontSize: 12, fontFamily: 'var(--mono)', fontWeight: 700, color: 'var(--text-secondary)', background: 'var(--bg3)', padding: '3px 8px', borderRadius: 5 }}>
            {record}
          </span>
        )}
        {hasTeam && onImport && (
          <button onClick={handleImport}
            style={{
              fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 6, cursor: 'pointer',
              border: `1px solid ${justImported ? '#4ade80' : 'var(--accent)'}`,
              background: justImported ? 'color-mix(in srgb, #4ade80 15%, transparent)' : 'color-mix(in srgb, var(--accent) 12%, transparent)',
              color: justImported ? '#4ade80' : 'var(--accent)', transition: 'all .2s', whiteSpace: 'nowrap',
            }}>
            {justImported ? '✓ Imported' : '↓ Import team'}
          </button>
        )}
      </div>
      {hasTeam && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {entry.team.map((pk, i) => (
            <PokemonChip key={i} pokemon={pk} expanded={expanded} onToggle={() => setExpanded(v => !v)} />
          ))}
        </div>
      )}
      {!hasTeam && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic', marginTop: 4 }}>No team list available</div>
      )}
    </div>
  );
}
