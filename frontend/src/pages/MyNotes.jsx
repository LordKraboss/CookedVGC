// src/pages/MyNotes.jsx
// Match-log tool: log a game (my team + opponent's team + W/L/D + notes),
// browse/edit history, see winrate stats, export/import as JSON or CSV.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTeams } from '../hooks/useTeams';
import { useNotes, getLastTeamId, setLastTeamId, getLastTags, setLastTags, tally, winrate, byTeam } from '../hooks/useNotes';
import { useRegulation } from '../lib/RegulationContext';
import { AutocompleteInput } from '../components/AutocompleteInput';
import { PokemonImage } from '../components/PokemonCard';
import { getPokemonSuggestions } from '../lib/api';

const NATURES = [
  'Hardy', 'Lonely', 'Brave', 'Adamant', 'Naughty', 'Bold', 'Docile', 'Relaxed',
  'Impish', 'Lax', 'Timid', 'Hasty', 'Serious', 'Jolly', 'Naive', 'Modest',
  'Mild', 'Quiet', 'Bashful', 'Rash', 'Calm', 'Gentle', 'Sassy', 'Careful', 'Quirky',
];

const RESULTS = [
  { key: 'win',  label: 'Win',  color: '#4ade80' },
  { key: 'lose', label: 'Lose', color: '#f87171' },
  { key: 'draw', label: 'Draw', color: '#fbbf24' },
];

const emptyOpp = () => ({ name: '', nature: '', item: '', ability: '', moves: ['', '', '', ''] });

function blankDraft(teamId, tags = []) {
  return { id: null, result: 'win', myTeamId: teamId || '', myBrought: [], opponent: [], oppBrought: [], tags, notes: '' };
}

// Tags are stored normalized (no leading #, lowercase, spaces → dashes) so the
// same tag groups consistently across notes regardless of how it was typed.
function normalizeTag(raw) {
  return String(raw || '').replace(/^#+/, '').trim().toLowerCase().replace(/\s+/g, '-');
}

// Ordered list of brought opponent species. Falls back to the legacy per-slot
// `brought` boolean for notes saved before bring-order tracking existed.
function oppBroughtOf(note) {
  if (Array.isArray(note.oppBrought)) return note.oppBrought;
  return (note.opponent || []).filter((o) => o.name && o.brought).map((o) => o.name);
}

function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function pct(v) {
  return v == null ? '—' : `${Math.round(v * 100)}%`;
}

function downloadFile(name, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function toCSV(notes) {
  const head = ['date', 'result', 'tags', 'my_team', 'my_species', 'my_brought', 'opponent_species', 'opponent_brought', 'notes'];
  const rows = notes.map((n) => [
    n.createdAt,
    n.result,
    (n.tags || []).join(' '),
    n.myTeamName || '',
    (n.myTeamSpecies || []).join(' / '),
    (n.myBrought || []).join(' / '),
    (n.opponent || []).map((o) => o.name).filter(Boolean).join(' / '),
    oppBroughtOf(n).join(' / '),
    n.notes || '',
  ].map(csvCell).join(','));
  return [head.join(','), ...rows].join('\n');
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function MyNotes() {
  const { teams } = useTeams();
  const { notes, addNote, updateNote, deleteNote, importNotes } = useNotes();
  const { activeRegId } = useRegulation();
  const fileRef = useRef(null);

  const [draft, setDraft] = useState(() => blankDraft(getLastTeamId() || teams[0]?.id, getLastTags()));
  const [oppQuery, setOppQuery] = useState('');
  const [filterTags, setFilterTags] = useState([]);
  const [page, setPage] = useState(0);
  const editing = draft.id != null;

  const teamById = useMemo(() => Object.fromEntries(teams.map((t) => [t.id, t])), [teams]);

  const allTags = useMemo(
    () => [...new Set(notes.flatMap((n) => n.tags || []))].sort(),
    [notes],
  );
  const filtered = useMemo(
    () => filterTags.length
      ? notes.filter((n) => filterTags.every((t) => (n.tags || []).includes(t)))
      : notes,
    [notes, filterTags],
  );

  const stats = useMemo(() => tally(filtered), [filtered]);
  const teamRows = useMemo(() => byTeam(filtered), [filtered]);

  const PAGE_SIZE = 10;
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  // Clamp the page when the result set shrinks (filter change, delete).
  useEffect(() => { if (page >= pageCount) setPage(0); }, [page, pageCount]);
  const pageNotes = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  // ── Draft mutators ──
  const setResult = (result) => setDraft((d) => ({ ...d, result }));
  const setMyTeam = (id) => { setLastTeamId(id); setDraft((d) => ({ ...d, myTeamId: id, myBrought: [] })); };
  const setNotesText = (notes) => setDraft((d) => ({ ...d, notes }));

  const addTag = (raw) => {
    const t = normalizeTag(raw);
    if (!t) return;
    setDraft((d) => {
      if (d.tags.includes(t)) return d;
      const tags = [...d.tags, t];
      setLastTags(tags);
      return { ...d, tags };
    });
  };
  const removeTag = (t) => setDraft((d) => {
    const tags = d.tags.filter((x) => x !== t);
    setLastTags(tags);
    return { ...d, tags };
  });
  const toggleFilterTag = (t) => {
    setPage(0);
    setFilterTags((f) => f.includes(t) ? f.filter((x) => x !== t) : [...f, t]);
  };

  // Toggle bring-order membership. Appending preserves click order; filtering
  // out reindexes the rest (mon 1 removed → 2,3 become 1,2).
  const toggleBrought = (key, name) => setDraft((d) => ({
    ...d,
    [key]: d[key].includes(name) ? d[key].filter((n) => n !== name) : [...d[key], name],
  }));

  const addOpp = (name) => setDraft((d) =>
    d.opponent.length >= 6 ? d : { ...d, opponent: [...d.opponent, { ...emptyOpp(), name }] });
  const patchOpp = (i, patch) => setDraft((d) => ({
    ...d, opponent: d.opponent.map((o, idx) => idx === i ? { ...o, ...patch } : o),
  }));
  const removeOpp = (i) => setDraft((d) => {
    const removed = d.opponent[i]?.name;
    return {
      ...d,
      opponent: d.opponent.filter((_, idx) => idx !== i),
      oppBrought: d.oppBrought.filter((n) => n !== removed),
    };
  });

  const startEdit = (n) => {
    setDraft({
      id: n.id, result: n.result, myTeamId: n.myTeamId || '',
      myBrought: n.myBrought || [],
      opponent: (n.opponent || []).map((o) => ({ ...emptyOpp(), ...o })),
      oppBrought: oppBroughtOf(n),
      tags: n.tags || [],
      notes: n.notes || '',
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const resetDraft = () => setDraft(blankDraft(getLastTeamId() || teams[0]?.id, getLastTags()));

  const submit = () => {
    const team = teamById[draft.myTeamId];
    const opponent = draft.opponent
      .filter((o) => o.name.trim())
      .map((o) => ({ ...o, moves: o.moves.filter(Boolean) }));
    const species = team ? team.slots.filter(Boolean).map((s) => s.name) : [];
    const oppNames = opponent.map((o) => o.name);
    const payload = {
      result: draft.result,
      myTeamId: draft.myTeamId || null,
      myTeamName: team?.name || '',
      myTeamSpecies: species,
      myBrought: draft.myBrought.filter((n) => species.includes(n)),
      opponent,
      oppBrought: draft.oppBrought.filter((n) => oppNames.includes(n)),
      tags: draft.tags,
      notes: draft.notes.trim(),
    };
    if (editing) updateNote(draft.id, payload);
    else addNote(payload);
    resetDraft();
  };

  const onImport = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try { importNotes(JSON.parse(reader.result)); }
      catch { alert('Could not read that file — expected a notes JSON export.'); }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 6 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>My Notes</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => downloadFile('vgc-notes.json', JSON.stringify(filtered, null, 2), 'application/json')} disabled={!filtered.length}>Export JSON</button>
          <button onClick={() => downloadFile('vgc-notes.csv', toCSV(filtered), 'text/csv')} disabled={!filtered.length}>Export CSV</button>
          <button onClick={() => fileRef.current?.click()}>Import</button>
          <input ref={fileRef} type="file" accept="application/json,.json" onChange={onImport} style={{ display: 'none' }} />
        </div>
      </div>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 0, marginBottom: 20 }}>
        Log your games to track winrate by team and scout the Pokémon you face.
      </p>

      <StatsHeader stats={stats} teamRows={teamRows} />

      {/* New / edit note */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)' }}>
            {editing ? 'Edit note' : 'New note'}
          </div>
          <TagEditor tags={draft.tags} allTags={allTags} onAdd={addTag} onRemove={removeTag} />
        </div>

        <div className="stack-mobile" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
          <Field label="My team">
            <select value={draft.myTeamId} onChange={(e) => setMyTeam(e.target.value)} style={inputStyle}>
              {!teams.length && <option value="">No saved teams</option>}
              {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </Field>
          <Field label="Result">
            <div style={{ display: 'flex', gap: 6 }}>
              {RESULTS.map((r) => {
                const active = draft.result === r.key;
                return (
                  <button key={r.key} onClick={() => setResult(r.key)} style={{
                    flex: 1, padding: '7px 0', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                    borderRadius: 8, border: `1px solid ${active ? r.color : 'var(--border)'}`,
                    background: active ? `color-mix(in srgb, ${r.color} 16%, var(--bg2))` : 'var(--bg2)',
                    color: active ? r.color : 'var(--text-secondary)',
                  }}>{r.label}</button>
                );
              })}
            </div>
          </Field>
        </div>

        <MyBroughtBand team={teamById[draft.myTeamId]} brought={draft.myBrought} onToggle={(name) => toggleBrought('myBrought', name)} />

        <Field label="Opponent's team">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {draft.opponent.map((o, i) => (
              <OpponentSlot key={i} opp={o} onPatch={(p) => patchOpp(i, p)} onRemove={() => removeOpp(i)}
                broughtPos={draft.oppBrought.indexOf(o.name) + 1}
                onToggleBrought={() => toggleBrought('oppBrought', o.name)} />
            ))}
            {draft.opponent.length < 6 && (
              <AutocompleteInput
                value={oppQuery}
                onChange={setOppQuery}
                onSelect={(name) => { addOpp(name); setOppQuery(''); }}
                placeholder="Add opponent Pokémon…"
                fetchSuggestions={(q) => getPokemonSuggestions(q, activeRegId)}
                queryKey={`opp-${activeRegId}`}
                style={{ maxWidth: 360 }}
              />
            )}
          </div>
        </Field>

        <Field label="Notes">
          <textarea
            value={draft.notes}
            onChange={(e) => setNotesText(e.target.value)}
            rows={4}
            placeholder="Leads, key turns, what to do differently next time…"
            style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }}
          />
        </Field>

        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <button className="primary" onClick={submit} disabled={!draft.myTeamId}>
            {editing ? 'Update note' : 'Save note'}
          </button>
          {editing && <button onClick={resetDraft}>Cancel</button>}
        </div>
      </div>

      {/* History */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, margin: '26px 0 12px' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)' }}>
          History {notes.length > 0 && <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>({filtered.length}{filterTags.length ? ` / ${notes.length}` : ''})</span>}
        </div>
        {allTags.length > 0 && (
          <TagFilter allTags={allTags} active={filterTags} onToggle={toggleFilterTag} onClear={() => { setPage(0); setFilterTags([]); }} />
        )}
      </div>
      {!filtered.length ? (
        <div style={{ ...cardStyle, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
          {notes.length ? 'No notes match the selected tags.' : 'No notes yet — log your first game above.'}
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {pageNotes.map((n) => (
              <HistoryRow key={n.id} note={n} editing={n.id === draft.id}
                onEdit={() => startEdit(n)} onDelete={() => deleteNote(n.id)} onTagClick={toggleFilterTag} activeTags={filterTags} />
            ))}
          </div>
          {pageCount > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14, marginTop: 16 }}>
              <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}>← Newer</button>
              <span style={{ fontSize: 12, fontFamily: 'var(--mono)', color: 'var(--text-muted)' }}>Page {page + 1} of {pageCount}</span>
              <button onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))} disabled={page >= pageCount - 1}>Older →</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatsHeader({ stats, teamRows }) {
  const total = stats.win + stats.lose + stats.draw;
  return (
    <div style={{ ...cardStyle, padding: 0, overflow: 'hidden' }}>
      <div className="stack-mobile" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', borderBottom: teamRows.length ? '1px solid var(--border)' : 'none' }}>
        <Stat label="Record" value={`${stats.win}-${stats.lose}-${stats.draw}`} />
        <Stat label="Winrate" value={pct(winrate(stats))} accent />
        <Stat label="Games" value={total} />
      </div>
      {teamRows.length > 0 && (
        <div style={{ padding: '12px 16px' }}>
          <div style={{ ...labelStyle, marginBottom: 8 }}>BY TEAM</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {teamRows.map((r) => {
              const wr = winrate(r);
              return (
                <div key={r.name} style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 13 }}>
                  <div style={{ flex: 1, minWidth: 0, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text-secondary)' }}>{r.win}-{r.lose}-{r.draw}</div>
                  <div style={{ width: 44, textAlign: 'right', fontFamily: 'var(--mono)', fontWeight: 700, color: 'var(--accent)' }}>{pct(wr)}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, accent }) {
  return (
    <div style={{ padding: '14px 16px', borderRight: '1px solid var(--border)' }}>
      <div style={labelStyle}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'var(--mono)', color: accent ? 'var(--accent)' : 'var(--text-primary)' }}>{value}</div>
    </div>
  );
}

function TagChip({ label, active, onClick, onRemove }) {
  return (
    <span
      onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px',
        borderRadius: 999, fontSize: 12, fontWeight: 600,
        cursor: onClick ? 'pointer' : 'default',
        border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
        background: active ? 'color-mix(in srgb, var(--accent) 18%, var(--bg2))' : 'var(--bg2)',
        color: active ? 'var(--accent)' : 'var(--text-secondary)',
      }}
    >
      #{label}
      {onRemove && (
        <span onClick={(e) => { e.stopPropagation(); onRemove(); }} style={{ cursor: 'pointer', opacity: 0.7, fontSize: 13 }}>×</span>
      )}
    </span>
  );
}

function TagEditor({ tags, allTags, onAdd, onRemove }) {
  const [input, setInput] = useState('');
  const listId = 'note-tags-datalist';
  const commit = () => { if (input.trim()) { onAdd(input); setInput(''); } };
  const suggestions = allTags.filter((t) => !tags.includes(t));
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end', maxWidth: 460 }}>
      {tags.map((t) => <TagChip key={t} label={t} onRemove={() => onRemove(t)} />)}
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commit(); }
          else if (e.key === 'Backspace' && !input && tags.length) onRemove(tags[tags.length - 1]);
        }}
        onBlur={commit}
        list={listId}
        placeholder="# add tag"
        style={{ ...inputStyle, width: 130, padding: '5px 8px', fontSize: 12 }}
      />
      <datalist id={listId}>
        {suggestions.map((t) => <option key={t} value={t} />)}
      </datalist>
    </div>
  );
}

function TagFilter({ allTags, active, onToggle, onClear }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      <span style={labelStyle}>FILTER</span>
      {allTags.map((t) => (
        <TagChip key={t} label={t} active={active.includes(t)} onClick={() => onToggle(t)} />
      ))}
      {active.length > 0 && (
        <button onClick={onClear} style={{ ...miniBtn, padding: '3px 8px' }}>Clear</button>
      )}
    </div>
  );
}

function BringBadge({ pos }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: 18, height: 18, borderRadius: 999, flexShrink: 0,
      background: 'var(--accent)', color: 'var(--bg1)',
      fontSize: 11, fontWeight: 800, fontFamily: 'var(--mono)',
    }}>{pos}</span>
  );
}

function MyBroughtBand({ team, brought, onToggle }) {
  const mons = (team?.slots || []).filter(Boolean);
  if (!mons.length) return null;
  return (
    <Field label="I brought (click to select)">
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {mons.map((m) => {
          const pos = brought.indexOf(m.name) + 1;
          const on = pos > 0;
          return (
            <button key={m.name} onClick={() => onToggle(m.name)} title={m.name} style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px 4px 4px', cursor: 'pointer',
              borderRadius: 999,
              border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`,
              background: on ? 'color-mix(in srgb, var(--accent) 16%, var(--bg2))' : 'var(--bg2)',
              opacity: on ? 1 : 0.55,
            }}>
              {on && <BringBadge pos={pos} />}
              <PokemonImage name={m.name} size={26} />
              <span style={{ fontSize: 12, fontWeight: 600, color: on ? 'var(--accent)' : 'var(--text-secondary)' }}>{m.name}</span>
            </button>
          );
        })}
      </div>
    </Field>
  );
}

function OpponentSlot({ opp, onPatch, onRemove, broughtPos, onToggleBrought }) {
  const [open, setOpen] = useState(false);
  const on = broughtPos > 0;
  const setMove = (idx, v) => onPatch({ moves: opp.moves.map((m, i) => i === idx ? v : m) });
  return (
    <div style={{ border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 8, background: 'var(--bg2)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 8px' }}>
        {on && <BringBadge pos={broughtPos} />}
        <PokemonImage name={opp.name} size={32} />
        <div style={{ flex: 1, fontSize: 13, fontWeight: 700 }}>{opp.name}</div>
        <button onClick={onToggleBrought} title="Opponent brought this Pokémon" style={{
          ...miniBtn,
          borderColor: on ? 'var(--accent)' : 'var(--border)',
          background: on ? 'color-mix(in srgb, var(--accent) 18%, var(--bg2))' : 'var(--bg2)',
          color: on ? 'var(--accent)' : 'var(--text-secondary)',
          fontWeight: on ? 700 : 400,
        }}>{on ? `Brought #${broughtPos}` : 'Brought'}</button>
        <button onClick={() => setOpen((v) => !v)} style={miniBtn}>{open ? 'Hide' : 'Details'}</button>
        <button onClick={onRemove} style={{ ...miniBtn, color: '#f87171' }}>✕</button>
      </div>
      {open && (
        <div style={{ padding: '4px 8px 10px', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <select value={opp.nature} onChange={(e) => onPatch({ nature: e.target.value })} style={{ ...inputStyle, width: 120, padding: '5px 8px' }}>
              <option value="">Nature</option>
              {NATURES.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
            <input value={opp.item} onChange={(e) => onPatch({ item: e.target.value })} placeholder="Item" style={{ ...inputStyle, flex: 1, minWidth: 120, padding: '5px 8px' }} />
            <input value={opp.ability} onChange={(e) => onPatch({ ability: e.target.value })} placeholder="Ability" style={{ ...inputStyle, flex: 1, minWidth: 120, padding: '5px 8px' }} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            {opp.moves.map((m, i) => (
              <input key={i} value={m} onChange={(e) => setMove(i, e.target.value)} placeholder={`Move ${i + 1}`} style={{ ...inputStyle, padding: '5px 8px' }} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function HistoryRow({ note, editing, onEdit, onDelete, onTagClick, activeTags = [] }) {
  const r = RESULTS.find((x) => x.key === note.result) || RESULTS[0];
  const opp = (note.opponent || []).filter((o) => o.name);
  const myBrought = note.myBrought || [];
  const oppBrought = oppBroughtOf(note);
  const tags = note.tags || [];
  const hasBody = opp.length || note.notes || myBrought.length || tags.length;
  return (
    <div style={{ ...cardStyle, padding: 14, borderColor: editing ? 'var(--accent)' : 'var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: hasBody ? 10 : 0 }}>
        <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.04em', padding: '3px 8px', borderRadius: 6, color: r.color, background: `color-mix(in srgb, ${r.color} 16%, transparent)` }}>{r.label.toUpperCase()}</span>
        <span style={{ fontSize: 13, fontWeight: 700 }}>{note.myTeamName || '(no team)'}</span>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{fmtDate(note.createdAt)}</span>
        {tags.map((t) => (
          <TagChip key={t} label={t} active={activeTags.includes(t)} onClick={onTagClick ? () => onTagClick(t) : undefined} />
        ))}
        <div style={{ flex: 1 }} />
        <button onClick={onEdit} style={miniBtn}>Edit</button>
        <button onClick={onDelete} style={{ ...miniBtn, color: '#f87171' }}>Delete</button>
      </div>
      {myBrought.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: opp.length || note.notes ? 10 : 0 }}>
          <span style={{ ...labelStyle, alignSelf: 'center' }}>I BROUGHT</span>
          {myBrought.map((name, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '3px 8px 3px 4px', border: '1px solid var(--accent)', borderRadius: 999, background: 'color-mix(in srgb, var(--accent) 14%, var(--bg2))' }}>
              <BringBadge pos={i + 1} />
              <PokemonImage name={name} size={22} />
              <span style={{ fontSize: 12, fontWeight: 600 }}>{name}</span>
            </div>
          ))}
        </div>
      )}
      {opp.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: note.notes ? 10 : 0 }}>
          <span style={{ ...labelStyle, alignSelf: 'center' }}>VS</span>
          {opp.map((o, i) => {
            const pos = oppBrought.indexOf(o.name) + 1;
            const on = pos > 0;
            return (
              <div key={i} title={[on ? `Brought #${pos}` : null, o.nature, o.item, o.ability, ...(o.moves || [])].filter(Boolean).join(' · ')}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5, padding: '3px 8px 3px 4px', borderRadius: 999,
                  border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`,
                  background: on ? 'color-mix(in srgb, var(--accent) 14%, var(--bg2))' : 'var(--bg2)',
                  opacity: on ? 1 : 0.6,
                }}>
                {on && <BringBadge pos={pos} />}
                <PokemonImage name={o.name} size={22} />
                <span style={{ fontSize: 12, fontWeight: 600 }}>{o.name}</span>
              </div>
            );
          })}
        </div>
      )}
      {note.notes && (
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{note.notes}</div>
      )}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label style={{ display: 'block', marginBottom: 14 }}>
      <div style={{ ...labelStyle, marginBottom: 6 }}>{label}</div>
      {children}
    </label>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const cardStyle = {
  background: 'var(--bg1)', border: '1px solid var(--border)',
  borderRadius: 12, padding: 18, marginBottom: 18,
};
const inputStyle = {
  width: '100%', background: 'var(--bg2)', border: '1px solid var(--border)',
  borderRadius: 8, color: 'var(--text-primary)', fontSize: 13,
  padding: '8px 10px', outline: 'none', fontFamily: 'inherit',
};
const labelStyle = {
  fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--text-muted)', letterSpacing: '.08em',
};
const miniBtn = {
  fontSize: 12, padding: '4px 8px', background: 'var(--bg2)',
  border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', color: 'var(--text-secondary)',
};
