// src/pages/TeamBuilder.jsx
import { useState, useCallback, memo, useTransition, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getTeamSuggestions, getPokemonSuggestions, validateTeam } from '../lib/api';
import { AutocompleteInput } from '../components/AutocompleteInput';
import { SortBar, sortPokemon, SORT_OPTIONS } from '../components/SortBar';
import { useTeams } from '../hooks/useTeams';
import { useRegulation } from '../lib/RegulationContext';
import { PokemonSlotCard } from '../components/PokemonSlotCard';
import { TypeCoverageModal } from '../components/TypeCoverageModal';
import NoStatsBanner from '../components/NoStatsBanner';
import {
  PokemonImage, TypePill, UsageBar,
  SectionLabel, EmptyState,
} from '../components/PokemonCard';

// ── Showdown paste parser ─────────────────────────────────────────────────────
const EV_KEYS = { hp: 'hp', atk: 'atk', def: 'def', spa: 'spa', 'sp. atk': 'spa', spd: 'spd', 'sp. def': 'spd', spe: 'spe' };

function parseShowdownPaste(text) {
  const blocks = text.trim().split(/\n\s*\n/).filter(Boolean);
  return blocks.slice(0, 6).map(block => {
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
    if (!lines.length) return null;

    // Line 1: "Name @ Item"  or  "Name (Nickname) @ Item"  or just "Name"
    let [namePart, itemPart = ''] = lines[0].split(' @ ');
    const name = namePart.replace(/\s*\([MF]\)\s*$/, '').replace(/\s*\(.+?\)\s*$/, '').trim();
    const item = itemPart.trim();

    let ability = '', nature = 'Hardy';
    const moves = [];
    const evs = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };

    for (const line of lines.slice(1)) {
      if (line.startsWith('Ability:')) {
        ability = line.replace('Ability:', '').trim();
      } else if (line.endsWith(' Nature')) {
        nature = line.replace(' Nature', '').trim();
      } else if (line.startsWith('EVs:')) {
        for (const seg of line.replace('EVs:', '').split('/')) {
          const m = seg.trim().match(/^(\d+)\s+(.+)$/);
          if (!m) continue;
          const key = EV_KEYS[m[2].toLowerCase()];
          if (key) {
            const raw = parseInt(m[1]);
            // ≤32 → Champions format (use as-is); >32 → Showdown format (÷8)
            evs[key] = raw <= 32 ? raw : Math.min(32, Math.round(raw / 8));
          }
        }
      } else if (line.startsWith('- ')) {
        moves.push(line.slice(2).trim());
      }
    }

    while (moves.length < 4) moves.push('');
    return { name, item, ability, nature, evs, moves: moves.slice(0, 4), types: [], usagePct: null };
  }).filter(Boolean);
}

// ── New team modal ────────────────────────────────────────────────────────────
function NewTeamModal({ onClose, onCreate, onImport }) {
  const [mode, setMode] = useState(null); // null | 'import'
  const [paste, setPaste] = useState('');
  const [error, setError] = useState('');

  const handleImport = () => {
    const slots = parseShowdownPaste(paste);
    if (!slots.length) { setError('Could not parse any Pokémon from the paste.'); return; }
    onImport(slots);
    onClose();
  };

  const OVERLAY = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 };
  const BOX = { background: 'var(--bg1)', border: '1px solid var(--border)', borderRadius: 16, padding: 28, width: mode === 'import' ? 520 : 340 };

  if (mode === 'import') {
    return (
      <div style={OVERLAY} onClick={onClose}>
        <div style={BOX} onClick={e => e.stopPropagation()}>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 14 }}>Import from Showdown</div>
          <textarea
            autoFocus
            value={paste}
            onChange={e => { setPaste(e.target.value); setError(''); }}
            placeholder="Paste your Showdown team here…"
            rows={14}
            style={{ fontFamily: 'var(--mono)', fontSize: 12, width: '100%', resize: 'vertical', marginBottom: 8 }}
          />
          {error && <div style={{ fontSize: 12, color: '#f87171', marginBottom: 8 }}>{error}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="primary" onClick={handleImport} style={{ flex: 1 }}>Import</button>
            <button onClick={() => setMode(null)} style={{ flex: 1 }}>Back</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={OVERLAY} onClick={onClose}>
      <div style={BOX} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 20 }}>New team</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button className="primary" onClick={() => { onCreate(); onClose(); }} style={{ padding: '12px 16px', fontSize: 14 }}>
            Create blank team
          </button>
          <button onClick={() => setMode('import')} style={{ padding: '12px 16px', fontSize: 14 }}>
            Import from Showdown paste
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Empty slot ────────────────────────────────────────────────────────────────
function EmptySlot({ onAdd }) {
  return (
    <div
      className="card"
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        minHeight: 200, cursor: 'pointer',
        border: '1px dashed var(--border)',
        transition: 'border-color .15s',
      }}
      onClick={onAdd}
      onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
      onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border)')}
    >
      <div style={{ fontSize: 32, color: 'var(--text-muted)', marginBottom: 8 }}>+</div>
      <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Add Pokémon</div>
    </div>
  );
}

// ── Add Pokémon modal ─────────────────────────────────────────────────────────
function AddModal({ onClose, onAdd, activeRegId, existingNames = [] }) {
  const [mode, setMode]           = useState('search'); // 'search' | 'paste'
  const [input, setInput]         = useState('');
  const [searchError, setSearchError] = useState('');
  const [paste, setPaste]         = useState('');
  const [pasteError, setPasteError] = useState('');

  const handleSearch = (name) => {
    const n = (name ?? input).trim();
    if (!n) return;
    if (existingNames.includes(n.toLowerCase())) {
      setSearchError(`${n} is already in your team.`);
      return;
    }
    onAdd({ name: n, types: [], usagePct: null });
    onClose();
  };

  const handlePaste = () => {
    const results = parseShowdownPaste(paste);
    if (!results.length) {
      setPasteError('Could not parse any Pokémon from the paste.');
      return;
    }
    const pokemon = results[0];
    if (existingNames.includes(pokemon.name.toLowerCase())) {
      setPasteError(`${pokemon.name} is already in your team.`);
      return;
    }
    onAdd(pokemon);
    onClose();
  };

  const OVERLAY = {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
  };

  if (mode === 'paste') {
    return (
      <div style={OVERLAY} onClick={onClose}>
        <div
          style={{ background: 'var(--bg1)', border: '1px solid var(--border)', borderRadius: 16, padding: 28, width: 480, maxWidth: '92vw' }}
          onClick={e => e.stopPropagation()}
        >
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 14 }}>📋 Paste from Showdown</div>
          <textarea
            autoFocus
            value={paste}
            onChange={e => { setPaste(e.target.value); setPasteError(''); }}
            placeholder={"Garchomp @ Rocky Helmet\nAbility: Rough Skin\nEVs: 252 HP / 4 Atk / 252 Spe\nJolly Nature\n- Dragon Claw\n- Earthquake\n- Swords Dance\n- Protect"}
            rows={10}
            style={{ fontFamily: 'var(--mono)', fontSize: 12, width: '100%', resize: 'vertical', marginBottom: 8 }}
          />
          {pasteError && <div style={{ fontSize: 12, color: '#f87171', marginBottom: 8 }}>{pasteError}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="primary" onClick={handlePaste} disabled={!paste.trim()} style={{ flex: 1 }}>
              Add
            </button>
            <button onClick={() => { setMode('search'); setPasteError(''); }} style={{ flex: 1 }}>
              Back
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={OVERLAY} onClick={onClose}>
      <div
        style={{ background: 'var(--bg1)', border: '1px solid var(--border)', borderRadius: 16, padding: 28, width: 480, maxWidth: '92vw' }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>Add Pokémon</div>
        <div style={{ marginBottom: searchError ? 8 : 14 }}>
          <AutocompleteInput
            value={input}
            onChange={v => { setInput(v); setSearchError(''); }}
            onSelect={handleSearch}
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
            placeholder="e.g. Incineroar, Flutter Mane…"
            fetchSuggestions={q => getPokemonSuggestions(q, activeRegId)}
            queryKey={`pokemon-${activeRegId}`}
          />
        </div>
        {searchError && (
          <div style={{ fontSize: 12, color: '#f87171', marginBottom: 10 }}>{searchError}</div>
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="primary" onClick={() => handleSearch()} style={{ flex: 1 }}>Add</button>
          <button onClick={() => setMode('paste')} style={{ flex: 2 }}>📋 Paste from Showdown</button>
          <button onClick={onClose} style={{ flex: 1 }}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ── Export modal ──────────────────────────────────────────────────────────────
function ExportModal({ text, onClose }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
    }} onClick={onClose}>
      <div
        style={{ background: 'var(--bg1)', border: '1px solid var(--border)', borderRadius: 16, padding: 28, width: 480, maxWidth: '92vw' }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 14 }}>Showdown export</div>
        <textarea
          readOnly
          value={text}
          rows={14}
          style={{ fontFamily: 'var(--mono)', fontSize: 12, width: '100%', resize: 'none', marginBottom: 12 }}
        />
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="primary" onClick={copy} style={{ flex: 1 }}>
            {copied ? '✓ Copied!' : 'Copy to clipboard'}
          </button>
          <button onClick={onClose} style={{ flex: 1 }}>Close</button>
        </div>
      </div>
    </div>
  );
}

// ── Suggestions panel ─────────────────────────────────────────────────────────
function SuggestionsPanel({ team, onAdd }) {
  const { currentRegId: activeRegId } = useRegulation();
  const navigate = useNavigate();

  // Default ascending: lower rank sum = better synergy
  const [sortKey, setSortKey] = useState('usage');
  const [sortDir, setSortDir] = useState('asc');
  const handleSort = useCallback((key) => {
    if (key === sortKey) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir(SORT_OPTIONS.find(o => o.key === key)?.defaultDir ?? 'desc');
    }
  }, [sortKey]);

  const [results, setResults]   = useState(null);   // null = not loaded
  const [loading, setLoading]   = useState(false);
  const loadedForKey = useRef(null);

  const filledNames = team.slots.filter(Boolean).map(p => p.name);
  const teamKey = filledNames.join(',');

  // Wipe results whenever team composition changes
  useEffect(() => {
    if (loadedForKey.current !== null && loadedForKey.current !== teamKey) {
      loadedForKey.current = null;
      setResults(null);
    }
  }, [teamKey]);

  const handleShow = useCallback(async () => {
    if (!filledNames.length || !activeRegId) return;
    setLoading(true);
    try {
      const data = await getTeamSuggestions(filledNames, activeRegId);
      loadedForKey.current = teamKey;
      setResults(data);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [filledNames, activeRegId, teamKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Empty team
  if (filledNames.length === 0) {
    return <EmptyState icon="◧" message="Add Pokémon to your team to get suggestions" />;
  }

  // ── Not yet loaded
  if (results === null) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-start' }}>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
          Based on your {filledNames.length} Pokémon — calculated on demand
        </div>
        <button
          className="primary"
          onClick={handleShow}
          disabled={loading}
          style={{ padding: '8px 16px', fontSize: 13 }}
        >
          {loading ? 'Calculating…' : 'Show team synergy →'}
        </button>
      </div>
    );
  }

  // ── Results
  // For this panel "Usage" means synergy score, not usagePct
  const sorted = sortKey === 'usage'
    ? [...results].sort((a, b) => sortDir === 'asc' ? a.score - b.score : b.score - a.score)
    : sortPokemon(results, sortKey, sortDir);

  return (
    <div>
      <SortBar sortKey={sortKey} sortDir={sortDir} onSort={handleSort} style={{ marginBottom: 12 }} />
      {sorted.length === 0 && <EmptyState icon="◎" message="No suggestions found" />}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {sorted.map((s, i) => (
          <div key={s.name} style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '10px 14px', background: 'var(--bg2)',
            border: '1px solid var(--border)', borderRadius: 10,
          }}>
            <span className="mono" style={{ fontSize: 11, color: 'var(--text-muted)', width: 18 }}>#{i + 1}</span>
            <PokemonImage name={s.name} size={40} spriteUrl={s.spriteUrl} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>{s.name}</div>
              <div style={{ display: 'flex', gap: 4, marginTop: 3 }}>
                {s.types.map(t => <TypePill key={t} type={t} />)}
              </div>
            </div>
            <span className="mono" style={{ fontSize: 12, color: 'var(--text-muted)', flexShrink: 0 }}
              title="Combined rank across team members — lower is better">
              ★ {s.score}{s.ranks?.length > 0 && (
                <span style={{ fontSize: 11, color: 'var(--text-muted)', opacity: 0.7 }}>
                  {' '}({s.ranks.join(' + ')})
                </span>
              )}
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                onClick={() => navigate(`/meta?q=${encodeURIComponent(s.name)}`)}
                style={{ padding: '5px 10px', fontSize: 12 }}
              >
                View
              </button>
              <button
                className="primary"
                onClick={() => onAdd(s)}
                style={{ padding: '5px 10px', fontSize: 12 }}
              >
                + Add
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Memoised slot wrapper ─────────────────────────────────────────────────────
// Gives each slot its own stable onUpdate/onRemove/onAdd so React.memo on
// PokemonSlotCard and EmptySlot can skip re-renders when sibling slots change.
const TeamSlotWrapper = memo(function TeamSlotWrapper({ index, pokemon, setSlot, clearSlot, setAddingSlot }) {
  const handleUpdate = useCallback((updatedOrFn) => setSlot(index, updatedOrFn), [index, setSlot]);
  const handleRemove = useCallback(() => clearSlot(index), [index, clearSlot]);
  const handleAdd    = useCallback(() => setAddingSlot(index), [index, setAddingSlot]);

  if (!pokemon) return <EmptySlot onAdd={handleAdd} />;
  return <PokemonSlotCard pokemon={pokemon} onUpdate={handleUpdate} onRemove={handleRemove} />;
});

// ── Legality badge ──────────────────────────────────────────────────────────
// Validates the team's filled slots against the current regulation's legal pool.
function TeamLegalityBadge({ team, regId }) {
  const [result, setResult] = useState(null);
  const [open, setOpen] = useState(false);
  const filled = team.slots.filter(Boolean);
  const key = `${regId}|${JSON.stringify(filled.map(s => [s.name, s.ability, s.item, s.moves, s.evs]))}`;

  useEffect(() => {
    if (filled.length === 0 || !regId) { setResult(null); return; }
    let cancelled = false;
    validateTeam(team.slots, regId)
      .then(r => { if (!cancelled) setResult(r); })
      .catch(() => { if (!cancelled) setResult(null); });
    return () => { cancelled = true; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  if (filled.length === 0 || !result) return null;

  if (!result.checkable) {
    return (
      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
        Legality data not synced for this regulation
      </span>
    );
  }

  if (result.legal) {
    return (
      <span style={{ fontSize: 12, fontWeight: 700, color: '#34d399' }}>
        ✓ Legal for this regulation
      </span>
    );
  }

  const flagged = result.slots.filter(s => !s.legal);
  const count = flagged.reduce((n, s) => n + s.problems.length, 0);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ fontSize: 12, fontWeight: 700, padding: '4px 10px', color: '#f87171', borderColor: 'rgba(248,113,113,0.4)', alignSelf: 'flex-start' }}
      >
        ⚠ {count} legality {count === 1 ? 'issue' : 'issues'} — {open ? 'hide' : 'show'}
      </button>
      {open && (
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {flagged.flatMap(s => s.problems.map((p, i) => <li key={`${s.index}-${i}`}>{p}</li>))}
        </ul>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function TeamBuilder() {
  const { currentRegId, currentReg } = useRegulation();
  const {
    teams, activeTeam,
    selectTeam, newTeam, renameTeam, deleteTeam,
    setSlot, clearSlot, exportShowdown,
  } = useTeams();

  const [addingSlot, setAddingSlot] = useState(null);
  const [showExport, setShowExport] = useState(false);
  const [showNewTeam, setShowNewTeam] = useState(false);
  const [showCoverage, setShowCoverage] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [, startTransition] = useTransition();

  const filledCount = activeTeam?.slots.filter(Boolean).length ?? 0;

  const handleAddSlot = (slotIndex, pokemon) => {
    setSlot(slotIndex, pokemon);
    setAddingSlot(null);
  };

  const startRename = () => {
    setNameInput(activeTeam.name);
    setEditingName(true);
  };

  const confirmRename = () => {
    if (nameInput.trim()) renameTeam(activeTeam.id, nameInput.trim());
    setEditingName(false);
  };

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-.02em' }}>My teams</h1>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>
            Stored locally · up to 50 teams
          </p>
        </div>
        <div style={{ flex: 1 }} />
        <button onClick={() => startTransition(() => setShowCoverage(true))} disabled={filledCount === 0}>
          ◈ Coverage
        </button>
        <button onClick={() => setShowExport(true)} disabled={filledCount === 0}>
          Export Showdown
        </button>
        <button className="primary" onClick={() => setShowNewTeam(true)}>+ New team</button>
      </div>

      {!currentReg?.syncMonth && (
        <NoStatsBanner>
          No usage stats for this regulation yet — Showdown hasn't published data for it.
          You can still build teams; Pokémon, move, item and ability search work off the
          full Showdown dex. Teammate suggestions need usage data and will appear once it lands.
        </NoStatsBanner>
      )}

      {/* Team tabs */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 20 }}>
        {teams.map(t => (
          <button
            key={t.id}
            onClick={() => startTransition(() => selectTeam(t.id))}
            style={{
              padding: '6px 14px', fontSize: 13,
              background: t.id === activeTeam?.id ? 'var(--accent-dim)' : 'var(--bg2)',
              borderColor: t.id === activeTeam?.id ? 'var(--accent)' : 'var(--border)',
              color: t.id === activeTeam?.id ? 'var(--accent)' : 'var(--text-secondary)',
            }}
          >
            {t.name}
          </button>
        ))}
      </div>

      {activeTeam && (
        <>
          {/* Team name edit */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
            {editingName ? (
              <>
                <input
                  autoFocus value={nameInput}
                  onChange={e => setNameInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && confirmRename()}
                  style={{ width: 200 }}
                />
                <button className="primary" onClick={confirmRename}>Save</button>
                <button onClick={() => setEditingName(false)}>Cancel</button>
              </>
            ) : (
              <>
                <div style={{ fontSize: 18, fontWeight: 700 }}>{activeTeam.name}</div>
                <button onClick={startRename} style={{ padding: '4px 10px', fontSize: 12 }}>Rename</button>
                {teams.length > 1 && (
                  <button
                    onClick={() => deleteTeam(activeTeam.id)}
                    style={{ padding: '4px 10px', fontSize: 12, color: '#f87171', borderColor: 'rgba(248,113,113,0.3)' }}
                  >
                    Delete
                  </button>
                )}
                <span className="mono" style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 4 }}>
                  {filledCount}/6 Pokémon
                </span>
              </>
            )}
            <div style={{ flex: 1 }} />
            <TeamLegalityBadge team={activeTeam} regId={currentRegId} />
          </div>

          {/* 6 slots grid — 3 per row */}
          <div className="stack-mobile" style={{
            display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 16, marginBottom: 32,
          }}>
            {activeTeam.slots.map((p, i) => (
              <TeamSlotWrapper
                key={i}
                index={i}
                pokemon={p}
                setSlot={setSlot}
                clearSlot={clearSlot}
                setAddingSlot={setAddingSlot}
              />
            ))}
          </div>

          {/* Suggestions */}
          <SectionLabel>Suggested teammates</SectionLabel>
          <SuggestionsPanel
            team={activeTeam}
            onAdd={(pokemon) => {
              const emptyIdx = activeTeam.slots.findIndex(s => s === null);
              if (emptyIdx !== -1) setSlot(emptyIdx, pokemon);
            }}
          />
        </>
      )}

      {/* Modals */}
      {showNewTeam && (
        <NewTeamModal
          onClose={() => setShowNewTeam(false)}
          onCreate={() => newTeam()}
          onImport={(slots) => {
            const filled = [...slots, ...Array(6).fill(null)].slice(0, 6);
            newTeam(filled, `Imported team`);
          }}
        />
      )}
      {addingSlot !== null && (
        <AddModal
          onClose={() => setAddingSlot(null)}
          onAdd={(p) => handleAddSlot(addingSlot, p)}
          activeRegId={currentRegId}
          existingNames={activeTeam.slots.filter(Boolean).map(p => p.name.toLowerCase())}
        />
      )}
      {showExport && (
        <ExportModal
          text={exportShowdown()}
          onClose={() => setShowExport(false)}
        />
      )}
      {showCoverage && (
        <TypeCoverageModal
          team={activeTeam?.slots ?? []}
          onClose={() => setShowCoverage(false)}
        />
      )}
    </div>
  );
}
