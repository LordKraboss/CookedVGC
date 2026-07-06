// src/pages/MySets.jsx
// Standalone Pokémon set library: build/save individual movesets and reuse
// them — import into a saved team, or send straight into the Calculator.
import { useState, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSets, isSameSetup } from '../hooks/useSets';
import { useRegulation } from '../lib/RegulationContext';
import { useCalculatorState } from '../lib/CalculatorContext';
import { AutocompleteInput } from '../components/AutocompleteInput';
import { PokemonSlotCard } from '../components/PokemonSlotCard';
import { AddToTeamButton } from '../components/AddToTeamButton';
import { PokemonImage } from '../components/PokemonCard';
import { getPokemonSuggestions } from '../lib/api';
import { ALL_TYPES } from '../lib/typeChart';

// ── Single-set Showdown paste parser (mirrors Calculator.jsx's version) ──────
function parseSetPaste(text) {
  const lines = text.trim().split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return null;

  const atIdx = lines[0].indexOf(' @ ');
  const namePart = atIdx >= 0 ? lines[0].slice(0, atIdx).trim() : lines[0].trim();
  const item = atIdx >= 0 ? lines[0].slice(atIdx + 3).trim() : '';

  const parenMatch = namePart.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
  const name = (parenMatch && !['M', 'F'].includes(parenMatch[2].trim()))
    ? parenMatch[2].trim()
    : namePart.replace(/\s*\([MF]\)\s*$/, '').trim();

  let ability = '', nature = 'Hardy', teraType = '';
  const moves = [];
  const evs = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
  const STAT_MAP = { HP: 'hp', Atk: 'atk', Def: 'def', SpA: 'spa', SpD: 'spd', Spe: 'spe' };

  for (const line of lines.slice(1)) {
    if (line.startsWith('Ability:')) ability = line.slice(8).trim();
    else if (line.startsWith('Tera Type:')) teraType = line.slice(10).trim();
    else if (line.startsWith('EVs:')) {
      line.slice(4).trim().split('/').forEach((part) => {
        const m = part.trim().match(/^(\d+)\s+(\w+)$/);
        if (!m) return;
        const key = STAT_MAP[m[2]];
        if (!key) return;
        const raw = parseInt(m[1]);
        evs[key] = raw <= 32 ? raw : Math.min(32, Math.round(raw / 8));
      });
    } else if (line.endsWith('Nature')) nature = line.slice(0, -6).trim();
    else if (line.startsWith('- ')) moves.push(line.slice(2).trim());
  }
  while (moves.length < 4) moves.push('');
  return name ? { name, item, ability, nature, evs, moves: moves.slice(0, 4), teraType, types: [], usagePct: null } : null;
}

// Mass import: multiple sets separated by a blank line, same as a Showdown
// team paste.
function parseSetsPaste(text) {
  return text.trim().split(/\n\s*\n/).map(parseSetPaste).filter(Boolean);
}

// Maps each nature to its +/- stat (mirrors Calculator.jsx's NATURE_STATS)
const NATURE_STATS = {
  Lonely: { plus: 'atk', minus: 'def' }, Brave: { plus: 'atk', minus: 'spe' },
  Adamant: { plus: 'atk', minus: 'spa' }, Naughty: { plus: 'atk', minus: 'spd' },
  Bold: { plus: 'def', minus: 'atk' }, Relaxed: { plus: 'def', minus: 'spe' },
  Impish: { plus: 'def', minus: 'spa' }, Lax: { plus: 'def', minus: 'spd' },
  Timid: { plus: 'spe', minus: 'atk' }, Hasty: { plus: 'spe', minus: 'def' },
  Jolly: { plus: 'spe', minus: 'spa' }, Naive: { plus: 'spe', minus: 'spd' },
  Modest: { plus: 'spa', minus: 'atk' }, Mild: { plus: 'spa', minus: 'def' },
  Quiet: { plus: 'spa', minus: 'spe' }, Rash: { plus: 'spa', minus: 'spd' },
  Calm: { plus: 'spd', minus: 'atk' }, Gentle: { plus: 'spd', minus: 'def' },
  Sassy: { plus: 'spd', minus: 'spe' }, Careful: { plus: 'spd', minus: 'spa' },
};

// Showdown-style EV shorthand with nature +/- markers, e.g. "32/0-/32+/0/2/0"
// — same convention Calculator.jsx defaults a new set's label to.
function evSpreadLabel(evs, nature) {
  const ns = NATURE_STATS[nature] || {};
  return ['hp', 'atk', 'def', 'spa', 'spd', 'spe']
    .map((k) => `${evs?.[k] ?? 0}${ns.plus === k ? '+' : ns.minus === k ? '-' : ''}`)
    .join('/');
}

// A saved set carries extra bookkeeping fields (id/label/teraType/timestamps)
// that My Teams' PokemonSet shape doesn't use — strip down before handing off.
function toTeamPokemon(s) {
  return {
    name: s.name, types: s.types ?? [], spriteUrl: s.spriteUrl ?? '',
    stats: s.stats, usagePct: s.usagePct ?? null,
    nature: s.nature ?? 'Hardy', evs: s.evs, moves: s.moves,
    item: s.item ?? '', ability: s.ability ?? '',
  };
}

// Builds a full Calculator "side" object (see CalculatorContext's defaultSide).
function toCalcSide(s) {
  return {
    name: s.name, item: s.item ?? '', ability: s.ability ?? '', nature: s.nature ?? 'Hardy',
    evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...s.evs },
    boosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    status: '', teraType: s.teraType ?? '', isTera: !!s.teraType,
    moves: [0, 1, 2, 3].map((i) => s.moves?.[i] ?? ''),
    bpOverrides: {},
    spriteUrl: s.spriteUrl ?? '', types: s.types ?? [], stats: s.stats ?? {},
    isTailwind: false, isHelpingHand: false,
    isReflect: false, isLightScreen: false, isAuroraVeil: false,
  };
}

export default function MySets() {
  const { sets, addSet, updateSet, deleteSet } = useSets();
  const { activeRegId } = useRegulation();
  const { setLeft, setRight } = useCalculatorState();
  const navigate = useNavigate();

  const [addQuery, setAddQuery] = useState('');
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [pasteError, setPasteError] = useState('');
  const [importNotice, setImportNotice] = useState(null); // [{name, label}] — sets skipped as exact duplicates
  const [filterQuery, setFilterQuery] = useState('');
  const [selectedId, setSelectedId] = useState(null);

  const filtered = useMemo(() => sets.filter((s) => {
    const q = filterQuery.trim().toLowerCase();
    if (!q) return true;
    return s.name.toLowerCase().includes(q) || (s.label || '').toLowerCase().includes(q);
  }), [sets, filterQuery]);
  const selected = sets.find((s) => s.id === selectedId) ?? null;

  // Show the 10 most recently added sets, "Show more" reveals older ones.
  // Resets to 10 whenever the filtered list changes (new filter, add, delete).
  const [visibleCount, setVisibleCount] = useState(10);
  const prevFilteredRef = useRef(filtered);
  if (prevFilteredRef.current !== filtered) {
    prevFilteredRef.current = filtered;
    if (visibleCount !== 10) setVisibleCount(10);
  }
  const visibleSets = filtered.slice(0, visibleCount);

  const handleAddSearch = (name) => {
    const n = (name ?? addQuery).trim();
    if (!n) return;
    const id = addSet({ name: n, types: [], usagePct: null });
    setAddQuery('');
    setSelectedId(id);
  };

  const handleAddPaste = () => {
    const parsedSets = parseSetsPaste(pasteText);
    if (!parsedSets.length) { setPasteError('Could not parse any Pokémon from the paste.'); return; }

    // Track sets as we go (not just pre-existing ones) so duplicates within
    // the same paste are caught too, not just ones already in storage.
    const known = [...sets];
    const dupes = [];
    let lastId = null;

    parsedSets.forEach((parsed) => {
      const payload = { ...parsed, label: evSpreadLabel(parsed.evs, parsed.nature) };
      const existing = known.find((s) => isSameSetup(s, payload));
      if (existing) {
        dupes.push({ name: parsed.name, label: existing.label || '(untitled)' });
        return;
      }
      const id = addSet(payload);
      known.push({ ...payload, id });
      lastId = id;
    });

    setPasteText('');
    setPasteError('');
    setPasteOpen(false);
    if (lastId) setSelectedId(lastId);
    setImportNotice(dupes.length ? dupes : null);
  };

  const handleDelete = (id) => {
    deleteSet(id);
    if (selectedId === id) setSelectedId(null);
  };

  const sendToCalc = (s, side) => {
    const built = toCalcSide(s);
    if (side === 'left') setLeft(built); else setRight(built);
    navigate('/tools/calculator');
  };

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 6 }}>My Sets</h1>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 0, marginBottom: 20 }}>
        Save individual Pokémon sets, then drop them into a team or the Calculator whenever you need them.
      </p>

      {importNotice && (
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: 10,
          padding: '12px 14px', marginBottom: 16, borderRadius: 10,
          background: 'var(--accent-dim)', border: '1px solid var(--accent)',
          fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5,
        }}>
          <span style={{ flexShrink: 0 }}>ℹ️</span>
          <div style={{ flex: 1 }}>
            {importNotice.length === 1 ? '1 set was' : `${importNotice.length} sets were`} already saved and skipped:
            <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
              {importNotice.map((d, i) => (
                <li key={i}>{d.name} has already this exact same set labelled <strong style={{ color: 'var(--text-primary)' }}>{d.label}</strong></li>
              ))}
            </ul>
          </div>
          <button onClick={() => setImportNotice(null)} style={{ ...miniBtn, flexShrink: 0 }}>✕</button>
        </div>
      )}

      {/* Add set */}
      <div style={cardStyle}>
        <div style={{ ...labelStyle, marginBottom: 8 }}>ADD A SET</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <AutocompleteInput
            value={addQuery}
            onChange={setAddQuery}
            onSelect={handleAddSearch}
            onKeyDown={(e) => e.key === 'Enter' && handleAddSearch()}
            placeholder="e.g. Incineroar, Flutter Mane…"
            fetchSuggestions={(q) => getPokemonSuggestions(q, activeRegId)}
            queryKey={`sets-add-${activeRegId}`}
            style={{ maxWidth: 360 }}
          />
          <button className="primary" onClick={() => handleAddSearch()}>+ Add</button>
          <button onClick={() => { setPasteOpen((v) => !v); setPasteError(''); }}>
            {pasteOpen ? 'Cancel paste' : '📋 Paste from Showdown (can mass import)'}
          </button>
        </div>
        {pasteOpen && (
          <div style={{ marginTop: 12 }}>
            <textarea
              autoFocus
              value={pasteText}
              onChange={(e) => { setPasteText(e.target.value); setPasteError(''); }}
              placeholder={'Incineroar @ Safety Goggles\nAbility: Intimidate\nTera Type: Grass\nEVs: 252 HP / 4 Atk / 252 SpD\nCareful Nature\n- Fake Out\n- Flare Blitz\n- Knock Off\n- Parting Shot\n\nSeparate multiple sets with a blank line to import several at once.'}
              rows={8}
              style={{ ...inputStyle, fontFamily: 'var(--mono)', resize: 'vertical', marginBottom: 8 }}
            />
            {pasteError && <div style={{ fontSize: 12, color: '#f87171', marginBottom: 8 }}>{pasteError}</div>}
            <button className="primary" onClick={handleAddPaste} disabled={!pasteText.trim()}>Add set(s)</button>
          </div>
        )}
      </div>

      {/* List + detail */}
      <div className="flex-col-mobile" style={{ display: 'flex', gap: 18, alignItems: 'flex-start' }}>
        {/* Set list */}
        <div style={{ width: 300, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ ...labelStyle }}>
            YOUR SETS {sets.length > 0 && `· ${sets.length}`}
          </div>
          <input
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            placeholder="Filter by species or label…"
            style={inputStyle}
          />
          {!sets.length ? (
            <div style={{ ...barStyle, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13, padding: '20px 14px' }}>
              No saved sets yet — add one above.
            </div>
          ) : !filtered.length ? (
            <div style={{ ...barStyle, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13, padding: '20px 14px' }}>
              No sets match "{filterQuery}".
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {visibleSets.map((s) => (
                  <SetRow key={s.id} s={s} active={s.id === selectedId} onClick={() => setSelectedId(s.id)} />
                ))}
              </div>
              {visibleCount < filtered.length && (
                <button onClick={() => setVisibleCount((c) => c + 10)} style={{ width: '100%' }}>
                  Show more ({filtered.length - visibleCount} remaining)
                </button>
              )}
            </>
          )}
        </div>

        {/* Detail */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {!selected ? (
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              padding: '100px 20px', borderRadius: 12, border: '1px dashed var(--border)',
              color: 'var(--text-muted)', fontSize: 15, gap: 12,
            }}>
              <span style={{ fontSize: 36 }}>🗂️</span>
              <span style={{ fontWeight: 600 }}>Select a set to view details</span>
              <span style={{ fontSize: 14, opacity: .7 }}>Click any saved set on the left</span>
            </div>
          ) : (
            <SetDetail
              key={selected.id}
              s={selected}
              onUpdate={(next) => updateSet(selected.id, next)}
              onRemove={() => handleDelete(selected.id)}
              onSendToCalc={(side) => sendToCalc(selected, side)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SetRow({ s, active, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left',
        padding: '8px 10px', borderRadius: 10,
        background: active ? 'color-mix(in srgb, var(--accent) 14%, var(--bg2))' : 'var(--bg2)',
        border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
      }}
    >
      <PokemonImage name={s.name} size={32} spriteUrl={s.spriteUrl} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {s.name}
        </div>
        {s.label && (
          <div style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {s.label}
          </div>
        )}
      </div>
      {s.item && <div style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>{s.item}</div>}
    </button>
  );
}

function SetDetail({ s, onUpdate, onRemove, onSendToCalc }) {
  return (
    <div>
      <div style={{ ...barStyle, marginBottom: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          value={s.label ?? ''}
          onChange={(e) => onUpdate((prev) => ({ ...prev, label: e.target.value }))}
          placeholder="Set label (optional)"
          style={{ flex: 1, background: 'transparent', border: 'none', fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', outline: 'none' }}
        />
        <select
          value={s.teraType ?? ''}
          onChange={(e) => onUpdate((prev) => ({ ...prev, teraType: e.target.value }))}
          title="Tera Type"
          style={{ fontSize: 12, padding: '4px 6px' }}
        >
          <option value="">Tera —</option>
          {ALL_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      <PokemonSlotCard pokemon={s} onUpdate={onUpdate} onRemove={onRemove} />

      <div style={{ ...barStyle, marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <AddToTeamButton pokemon={toTeamPokemon(s)} />
        <button onClick={() => onSendToCalc('left')} style={{ fontSize: 12, padding: '5px 10px' }}>→ Calculator (Left)</button>
        <button onClick={() => onSendToCalc('right')} style={{ fontSize: 12, padding: '5px 10px' }}>→ Calculator (Right)</button>
      </div>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const cardStyle = {
  background: 'var(--bg1)', border: '1px solid var(--border)',
  borderRadius: 12, padding: 18, marginBottom: 18,
};
const barStyle = {
  background: 'var(--bg2)', border: '1px solid var(--border)',
  borderRadius: 10, padding: '8px 14px',
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
