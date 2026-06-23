// src/pages/Calculator.jsx
// VGC Damage Calculator — always level 50, always Doubles
import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useCalculatorState } from '../lib/CalculatorContext';
import { useQuery } from '@tanstack/react-query';
import { calculate, Generations, Pokemon as CalcPokemon, Move as CalcMove, Field as CalcField } from '@smogon/calc';
import { getUsage, getPokemonMeta, getMoveSuggestions, getItemSuggestions } from '../lib/api';
import { useRegulation } from '../lib/RegulationContext';
import { useTeams } from '../hooks/useTeams';
import { PokemonImage } from '../components/PokemonCard';
import { AutocompleteInput } from '../components/AutocompleteInput';

// ── Constants — hardcoded to VGC rules ────────────────────────────────────────
const GEN   = Generations.get(9);
const LEVEL = 50;

const NATURES = [
  'Hardy','Lonely','Brave','Adamant','Naughty','Bold','Docile','Relaxed','Impish','Lax',
  'Timid','Hasty','Serious','Jolly','Naive','Modest','Mild','Quiet','Bashful','Rash',
  'Calm','Gentle','Sassy','Careful','Quirky',
];

// Maps each nature to its +/- stats (null = neutral)
const NATURE_STATS = {
  Hardy: null, Docile: null, Serious: null, Bashful: null, Quirky: null,
  Lonely:  { plus: 'atk', minus: 'def' },
  Brave:   { plus: 'atk', minus: 'spe' },
  Adamant: { plus: 'atk', minus: 'spa' },
  Naughty: { plus: 'atk', minus: 'spd' },
  Bold:    { plus: 'def', minus: 'atk' },
  Relaxed: { plus: 'def', minus: 'spe' },
  Impish:  { plus: 'def', minus: 'spa' },
  Lax:     { plus: 'def', minus: 'spd' },
  Timid:   { plus: 'spe', minus: 'atk' },
  Hasty:   { plus: 'spe', minus: 'def' },
  Jolly:   { plus: 'spe', minus: 'spa' },
  Naive:   { plus: 'spe', minus: 'spd' },
  Modest:  { plus: 'spa', minus: 'atk' },
  Mild:    { plus: 'spa', minus: 'def' },
  Quiet:   { plus: 'spa', minus: 'spe' },
  Rash:    { plus: 'spa', minus: 'spd' },
  Calm:    { plus: 'spd', minus: 'atk' },
  Gentle:  { plus: 'spd', minus: 'def' },
  Sassy:   { plus: 'spd', minus: 'spe' },
  Careful: { plus: 'spd', minus: 'spa' },
};

const TYPES = [
  'Normal','Fire','Water','Electric','Grass','Ice','Fighting','Poison',
  'Ground','Flying','Psychic','Bug','Rock','Ghost','Dragon','Dark','Steel','Fairy',
];

const STATUSES    = ['', 'brn', 'par', 'psn', 'tox', 'frz', 'slp'];
const STATUS_LABEL = { '': 'None', brn: 'Burn', par: 'Para', psn: 'Poison', tox: 'Toxic', frz: 'Frozen', slp: 'Sleep' };
const STATUS_COLOR = { '': 'var(--text-muted)', brn: '#f97316', par: '#facc15', psn: '#a78bfa', tox: '#a78bfa', frz: '#60a5fa', slp: '#94a3b8' };

const WEATHERS = ['', 'Sun', 'Rain', 'Sand', 'Snow'];
const TERRAINS = ['', 'Electric', 'Grassy', 'Misty', 'Psychic'];
const WEATHER_COLOR = { '': 'var(--text-muted)', Sun: '#fb923c', Rain: '#60a5fa', Sand: '#d97706', Snow: '#bae6fd' };
const TERRAIN_COLOR = { '': 'var(--text-muted)', Electric: '#facc15', Grassy: '#4ade80', Misty: '#f9a8d4', Psychic: '#c084fc' };

const STAT_KEYS   = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
const STAT_LABEL  = { hp: 'HP', atk: 'Atk', def: 'Def', spa: 'SpA', spd: 'SpD', spe: 'Spe' };
const BOOST_STATS = ['atk', 'def', 'spa', 'spd', 'spe'];

// ── Item name normalisation ───────────────────────────────────────────────────
// smogon/calc requires the EXACT display name ("Shuca Berry", "Hard Stone").
// Any other casing / spacing is silently ignored and the item has no effect.
// We normalise via toID → GEN.items lookup to always get the canonical name.
const _toId = s => ('' + s).toLowerCase().replace(/[^a-z0-9]+/g, '');
function resolveItemName(raw) {
  if (!raw) return undefined;
  return GEN.items.get(_toId(raw))?.name ?? raw;
}

// ── Counter-based variable-BP moves ──────────────────────────────────────────
// These moves' real BP depends on a hidden battle counter @smogon/calc can't
// infer (it falls back to flat `move.bp`), so we let the user set it manually.
// Every other variable-BP move (Electro Ball, Gyro Ball, Stored Power, Reversal,
// Heavy Slam, Crush Grip, weather/terrain moves…) is auto-computed by the calc.
const VARIABLE_BP_MOVES = {
  lastrespects: { base: 50, step: 50, max: 300, hint: '+50 per fainted ally' },
  ragefist:     { base: 50, step: 50, max: 350, hint: '+50 per hit taken' },
};
function variableBpInfo(moveName) {
  return VARIABLE_BP_MOVES[_toId(moveName)] ?? null;
}

// Build a CalcMove, applying the attacker's manual BP override for counter-based
// moves (Last Respects, Rage Fist). Shared by the calc and both optimizers so
// they all sweep against the same boosted BP.
function makeCalcMove(atkSide, moveName) {
  const info = variableBpInfo(moveName);
  const override = info ? atkSide?.bpOverrides?.[_toId(moveName)] : undefined;
  return new CalcMove(GEN, moveName,
    override != null ? { overrides: { basePower: override } } : undefined);
}

// ── Stat calculation (level 50, IV 31) ───────────────────────────────────────
function natureMult(nature, stat) {
  if (stat === 'hp') return 1;
  const ns = NATURE_STATS[nature];
  if (!ns) return 1;
  if (ns.plus  === stat) return 1.1;
  if (ns.minus === stat) return 0.9;
  return 1;
}

// evPoints: 0-32 (Champions format). floor(evPoints*8/4) = evPoints*2
function calcStat(base, evPoints, stat, nature = 'Hardy') {
  if (!base) return null;
  const inner = Math.floor(((2 * base + 31 + (evPoints ?? 0) * 2) * 50) / 100);
  if (stat === 'hp') return inner + 60;            // + level(50) + 10
  return Math.floor((inner + 5) * natureMult(nature, stat));
}

// ── Default state ─────────────────────────────────────────────────────────────
const defaultSide = () => ({
  name: '', item: '', ability: '', nature: 'Hardy',
  evs:    { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
  boosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
  status: '', teraType: '', isTera: false,
  moves:  ['', '', '', ''],
  bpOverrides: {},
  spriteUrl: '', types: [], stats: {},
  // side-specific field toggles
  isTailwind: false, isHelpingHand: false,
  isReflect: false, isLightScreen: false, isAuroraVeil: false,
});

const defaultField = () => ({ weather: '', terrain: '' });

// ── smogon/calc builders ──────────────────────────────────────────────────────
function toCalcPokemon(side) {
  if (!side.name) return null;
  try {
    return new CalcPokemon(GEN, side.name, {
      level:    LEVEL,
      nature:   side.nature   || 'Hardy',
      item:     resolveItemName(side.item),
      ability:  side.ability  || undefined,
      evs:      Object.fromEntries(STAT_KEYS.map(k => [k, (side.evs[k] ?? 0) * 8])),
      boosts:   side.boosts,
      status:   side.status   || undefined,
      teraType: (side.isTera && side.teraType) ? side.teraType : undefined,
    });
  } catch {
    return null;
  }
}

function toCalcField(fieldCfg, atkSide, defSide) {
  return new CalcField({
    gameType: 'Doubles',
    weather:  fieldCfg.weather || undefined,
    terrain:  fieldCfg.terrain || undefined,
    attackerSide: {
      isTailwind:    atkSide.isTailwind    || false,
      isHelpingHand: atkSide.isHelpingHand || false,
      isReflect:     atkSide.isReflect     || false,
      isLightScreen: atkSide.isLightScreen || false,
      isAuroraVeil:  atkSide.isAuroraVeil  || false,
    },
    defenderSide: {
      isTailwind:    defSide.isTailwind    || false,
      isReflect:     defSide.isReflect     || false,
      isLightScreen: defSide.isLightScreen || false,
      isAuroraVeil:  defSide.isAuroraVeil  || false,
    },
  });
}

function runCalc(atkSide, defSide, moveName, fieldCfg) {
  if (!moveName) return null;
  const atk = toCalcPokemon(atkSide);
  const def = toCalcPokemon(defSide);
  if (!atk || !def) return null;
  try {
    const varBp = variableBpInfo(moveName);
    const move  = makeCalcMove(atkSide, moveName);
    // move.type is undefined when smogon/calc doesn't recognise the move name
    if (move.type === undefined) return { moveName, error: true };
    const field  = toCalcField(fieldCfg, atkSide, defSide);
    const result = calculate(GEN, atk, def, move, field);

    // Pass err=false: fullDesc() throws when damage=0 (type immunity) by default;
    // we handle that case ourselves below instead.
    const desc = result.fullDesc?.('%', false) ?? '';

    // Damage range [min, max] — 0/0 means type immunity (no effect)
    const [dmgMin, dmgMax] = result.range();
    if (dmgMax === 0) return { moveName, immune: true };

    // "(X.X - Y.Y%)" or "(X.X -- Y.Y%)"
    const pctMatch = desc.match(/\(([0-9.]+)\s*-+\s*([0-9.]+)%\)/);
    const minPct   = pctMatch ? parseFloat(pctMatch[1]) : null;
    const maxPct   = pctMatch ? parseFloat(pctMatch[2]) : null;

    // KO description after "--"
    const koMatch = desc.match(/--\s*(.+)$/);
    const koDesc  = koMatch ? koMatch[1].trim() : null;

    // Effective base power: rawDesc.moveBP holds the field/condition-adjusted BP
    // (e.g. Rising Voltage 140, Weather Ball 100); undefined when it equals move.bp.
    const baseBP = move.bp;
    const effBP  = result.rawDesc?.moveBP ?? baseBP;

    // All 16 damage rolls as HP percentages (handles multi-hit via normalizeDamage)
    const defHP   = def.stats.hp;
    const rawDmg  = normalizeDamage(result.damage);
    const rolls   = rawDmg ? rawDmg.map(d => parseFloat((d / defHP * 100).toFixed(1))) : null;

    return { moveName, desc, minPct, maxPct, koDesc, rolls, bp: effBP, baseBP, varBp };
  } catch (e) {
    console.warn(`[Calc] "${moveName}" failed:`, e.message);
    return { moveName, error: true };
  }
}

// ── Tiny shared components ────────────────────────────────────────────────────
function SectionLabel({ children, style }) {
  return (
    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.08em', color: 'var(--text-muted)', marginBottom: 5, ...style }}>
      {children}
    </div>
  );
}

function Chip({ label, active, onClick, color = 'var(--accent)' }) {
  return (
    <button onClick={onClick} style={{
      padding: '3px 9px', borderRadius: 6, fontSize: 11, cursor: 'pointer',
      fontFamily: 'var(--mono)', fontWeight: active ? 700 : 400,
      background: active ? `color-mix(in srgb, ${color} 18%, transparent)` : 'var(--bg2)',
      border: `1px solid ${active ? color : 'var(--border)'}`,
      color: active ? color : 'var(--text-muted)',
    }}>
      {label}
    </button>
  );
}

function BoostControl({ value, onChange }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
      <button onClick={() => onChange(Math.min(6, value + 1))}
        style={{ width: 18, height: 18, padding: 0, fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#4ade80', fontWeight: 700 }}>+</button>
      <span style={{
        fontFamily: 'var(--mono)', fontSize: 11, minWidth: 20, textAlign: 'center',
        color: value > 0 ? '#4ade80' : value < 0 ? '#f87171' : 'var(--text-muted)',
        fontWeight: value !== 0 ? 700 : 400,
      }}>
        {value > 0 ? `+${value}` : value}
      </span>
      <button onClick={() => onChange(Math.max(-6, value - 1))}
        style={{ width: 18, height: 18, padding: 0, fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#f87171', fontWeight: 700 }}>−</button>
    </div>
  );
}

// ── Pokémon name search (local suggestions from usage list) ───────────────────
function PokeSearch({ value, onChange, allNames }) {
  const [open,    setOpen]    = useState(false);
  const [focused, setFocused] = useState(false);
  const [idx,     setIdx]     = useState(-1);
  const wrapRef = useState(null);

  const sugg = useMemo(() => {
    if (!focused || value.length < 1) return [];
    const q = value.toLowerCase();
    return allNames.filter(n => n.toLowerCase().includes(q)).slice(0, 8);
  }, [allNames, value, focused]);

  const select = name => { onChange(name); setOpen(false); };

  return (
    <div ref={el => { wrapRef[1](el); }} style={{ position: 'relative', flex: 1 }}>
      <input
        value={value}
        onChange={e => { onChange(e.target.value); setIdx(-1); setOpen(true); }}
        onFocus={() => { setFocused(true); if (sugg.length > 0) setOpen(true); }}
        onBlur={() => setTimeout(() => { setOpen(false); setFocused(false); }, 150)}
        onKeyDown={e => {
          if (!open) return;
          if (e.key === 'ArrowDown') { e.preventDefault(); setIdx(i => Math.min(i + 1, sugg.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx(i => Math.max(i - 1, -1)); }
          else if (e.key === 'Enter' && idx >= 0) { e.preventDefault(); select(sugg[idx]); }
          else if (e.key === 'Escape') setOpen(false);
        }}
        placeholder="Pokémon name…"
        style={{ width: '100%' }}
      />
      {open && sugg.length > 0 && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 300,
          background: 'var(--bg1)', border: '1px solid var(--border)',
          borderRadius: 8, overflow: 'hidden', boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
        }}>
          {sugg.map((name, i) => (
            <div key={name} onMouseDown={() => select(name)} onMouseEnter={() => setIdx(i)} style={{
              padding: '8px 12px', fontSize: 13, cursor: 'pointer',
              background: i === idx ? 'var(--accent-dim)' : 'transparent',
              color: i === idx ? 'var(--accent)' : 'var(--text-primary)',
              borderBottom: i < sugg.length - 1 ? '1px solid var(--border)' : 'none',
            }}>{name}</div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Parse a Showdown paste into a side state ──────────────────────────────────
function parseShowdownPaste(text) {
  const lines = text.trim().split('\n').map(l => l.trim()).filter(Boolean);
  if (!lines.length) return null;

  const result = { ...defaultSide() };
  let moveIndex = 0;

  // First line: "Nickname (Species) @ Item"  or  "Species @ Item"  or just "Species"
  const atIdx = lines[0].indexOf(' @ ');
  const namePart = atIdx >= 0 ? lines[0].slice(0, atIdx).trim() : lines[0].trim();
  if (atIdx >= 0) result.item = lines[0].slice(atIdx + 3).trim();

  // Distinguish "Nickname (Species)" from "Species (M)" / "Species (F)"
  const parenMatch = namePart.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
  if (parenMatch && !['M', 'F'].includes(parenMatch[2].trim())) {
    result.name = parenMatch[2].trim(); // real species name is in parens
  } else {
    result.name = namePart.replace(/\s*\([MF]\)\s*$/, '').trim();
  }

  const STAT_MAP = { HP: 'hp', Atk: 'atk', Def: 'def', SpA: 'spa', SpD: 'spd', Spe: 'spe' };

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('Ability:')) {
      result.ability = line.slice(8).trim();
    } else if (line.startsWith('Tera Type:')) {
      result.teraType = line.slice(10).trim();
      result.isTera = true;
    } else if (line.startsWith('EVs:')) {
      line.slice(4).trim().split('/').forEach(part => {
        const m = part.trim().match(/^(\d+)\s+(\w+)$/);
        if (m) {
          const key = STAT_MAP[m[2]];
          if (key) {
            const raw = parseInt(m[1]);
            // ≤ 32 → Champions format (use as-is); > 32 → Showdown format (÷ 8)
            result.evs[key] = raw <= 32 ? raw : Math.min(32, Math.round(raw / 8));
          }
        }
      });
    } else if (line.endsWith('Nature')) {
      result.nature = line.slice(0, -6).trim();
    } else if (line.startsWith('- ') && moveIndex < 4) {
      result.moves[moveIndex++] = line.replace(/^-\s*/, '').trim();
    }
  }

  return result.name ? result : null;
}

// ── Team import dropdown ──────────────────────────────────────────────────────
function TeamImport({ onImport }) {
  const [open, setOpen]           = useState(false);
  const [pasteMode, setPasteMode] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [pasteError, setPasteError] = useState('');
  const { activeTeam } = useTeams();
  // Keep original slot index so we can build the "team:id:slotIdx" key
  const filled = activeTeam
    ? activeTeam.slots
        .map((slot, idx) => ({ slot, idx }))
        .filter(({ slot }) => Boolean(slot))
    : [];

  function handleApplyPaste() {
    const parsed = parseShowdownPaste(pasteText);
    if (!parsed) {
      setPasteError('Could not parse paste — make sure it is a valid Showdown export.');
      return;
    }
    onImport(parsed);
    setPasteMode(false);
    setPasteText('');
    setPasteError('');
    setOpen(false);
  }

  function handleCancelPaste() {
    setPasteMode(false);
    setPasteText('');
    setPasteError('');
  }

  // Paste modal (floats from the Import button anchor)
  const pastePanel = pasteMode && (
    <>
      {/* backdrop */}
      <div style={{ position: 'fixed', inset: 0, zIndex: 299 }} onMouseDown={handleCancelPaste} />
      <div style={{
        position: 'absolute', top: 'calc(100% + 4px)', right: 0, zIndex: 300,
        background: 'var(--bg1)', border: '1px solid var(--border)',
        borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
        padding: 12, width: 300, display: 'flex', flexDirection: 'column', gap: 8,
      }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>
          📋 Paste Showdown export
        </span>
        <textarea
          autoFocus
          value={pasteText}
          onChange={e => { setPasteText(e.target.value); setPasteError(''); }}
          placeholder={"Garchomp @ Rocky Helmet\nAbility: Rough Skin\nEVs: 252 HP / 4 Atk / 252 Spe\nJolly Nature\n- Dragon Claw\n- Earthquake\n- Swords Dance\n- Protect"}
          style={{
            width: '100%', height: 140, resize: 'vertical', fontSize: 11,
            background: 'var(--bg2)', border: '1px solid var(--border)',
            borderRadius: 6, color: 'var(--text-primary)', padding: 8,
            fontFamily: 'monospace', boxSizing: 'border-box',
          }}
        />
        {pasteError && (
          <span style={{ fontSize: 11, color: '#f87171' }}>{pasteError}</span>
        )}
        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
          <button onClick={handleCancelPaste} style={{ fontSize: 11, padding: '4px 10px' }}>
            Cancel
          </button>
          <button
            onClick={handleApplyPaste}
            disabled={!pasteText.trim()}
            style={{ fontSize: 11, padding: '4px 10px', opacity: pasteText.trim() ? 1 : 0.45 }}
          >
            Apply
          </button>
        </div>
      </div>
    </>
  );

  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      <button onClick={() => setOpen(v => !v)} style={{ fontSize: 11, padding: '4px 10px' }}>
        Import ▾
      </button>
      {pastePanel}
      {!pasteMode && open && (
        <>
          {/* backdrop */}
          <div style={{ position: 'fixed', inset: 0, zIndex: 299 }} onMouseDown={() => setOpen(false)} />
          <div style={{
            position: 'absolute', top: 'calc(100% + 4px)', right: 0, zIndex: 300,
            background: 'var(--bg1)', border: '1px solid var(--border)',
            borderRadius: 8, overflow: 'hidden', boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
            minWidth: 160,
          }}>
            {filled.length === 0 && (
              <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--text-muted)' }}>
                No team Pokémon
              </div>
            )}
            {filled.map(({ slot: p, idx }) => (
              <div
                key={`${p.name}-${idx}`}
                onMouseDown={() => {
                  onImport(p, `team:${activeTeam.id}:${idx}`);
                  setOpen(false);
                }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '8px 12px', cursor: 'pointer', fontSize: 13,
                  borderBottom: '1px solid var(--border)',
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--bg2)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <PokemonImage name={p.name} size={20} spriteUrl={p.spriteUrl} />
                <span>{p.name}</span>
              </div>
            ))}
            {/* Paste from Showdown option — always at the bottom */}
            <div
              onMouseDown={() => { setOpen(false); setPasteMode(true); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '8px 12px', cursor: 'pointer', fontSize: 13,
                color: 'var(--text-muted)',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--bg2)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <span>📋</span>
              <span>Paste from Showdown…</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── Side panel ────────────────────────────────────────────────────────────────
const SELECT_STYLE = {
  width: '100%', background: 'var(--bg2)', border: '1px solid var(--border)',
  borderRadius: 8, color: 'var(--text-primary)', padding: '5px 8px',
  fontSize: 12, outline: 'none', cursor: 'pointer',
};

// ── Bulk Optimizer helpers ────────────────────────────────────────────────────
const PLUS_DEF_NATURES = ['Bold', 'Relaxed', 'Impish', 'Lax'];
const PLUS_SPD_NATURES = ['Calm', 'Gentle', 'Sassy', 'Careful'];

const THRESHOLD_OPTIONS = [
  { label: '16/16', idx: 15, desc: 'Always survive' },
  { label: '15/16', idx: 14, desc: '15 out of 16 rolls' },
  { label: '12/16', idx: 11, desc: '12 out of 16 rolls' },
];

// Normalise raw damage from smogon/calc into a flat 16-roll array.
// Single-hit  → already a number[16], return as-is.
// Multi-hit   → sum rolls element-wise across all hits (same-rank assumption).
// Fixed/other → return null (skip in calcs).
function normalizeDamage(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  if (typeof raw[0] === 'number') {
    return raw.length >= 16 ? raw : null;
  }
  // Multi-hit: raw is number[][]
  const out = new Array(16).fill(0);
  for (const hit of raw) {
    if (!Array.isArray(hit) || hit.length < 16) return null;
    for (let i = 0; i < 16; i++) out[i] += hit[i];
  }
  return out;
}

// Find which of the attacker's moves deals the most damage to the defender.
// Handles single-hit and multi-hit moves.
// Returns { moveName, category, dmg, defHP } or null.
function findStrongestMoveForBulk(atkSide, defSide, fieldCfg = defaultField()) {
  const atk = toCalcPokemon(atkSide);
  const def = toCalcPokemon(defSide);
  if (!atk || !def) return null;
  const field = toCalcField(fieldCfg, atkSide, defSide);
  let best = null;
  let bestMaxDmg = -1;
  for (const moveName of atkSide.moves.filter(Boolean)) {
    try {
      const move = makeCalcMove(atkSide, moveName);
      if (move.type === undefined || move.category === 'Status') continue;
      const result = calculate(GEN, atk, def, move, field);
      const dmg = normalizeDamage(result.damage);
      if (!dmg) continue;
      if (dmg[15] > bestMaxDmg) {
        bestMaxDmg = dmg[15];
        best = { moveName, category: move.category, dmg, defHP: def.stats.hp };
      }
    } catch { /* skip unknown/unsupported moves */ }
  }
  return best;
}

// Sweep HP × def/spd EVs (0-32 each) to find minimum total that survives at threshold.
// thresholdIdx: 15 = 16/16, 14 = 15/16, 11 = 12/16
function sweepBulkEvs(atkSide, defSide, moveName, category, thresholdIdx, nature, fieldCfg = defaultField()) {
  const atk = toCalcPokemon(atkSide);
  if (!atk) return null;
  let move;
  try {
    move = makeCalcMove(atkSide, moveName);
    if (move.type === undefined) return null;
  } catch { return null; }

  const defStat  = category === 'Physical' ? 'def' : 'spd';
  const baseEvs  = Object.fromEntries(STAT_KEYS.map(k => [k, (defSide.evs[k] ?? 0) * 8]));
  const field    = toCalcField(fieldCfg, atkSide, defSide);
  const defOpts  = {
    level:    LEVEL,
    nature,
    item:     resolveItemName(defSide.item),
    ability:  defSide.ability  || undefined,
    boosts:   defSide.boosts,
    status:   defSide.status   || undefined,
    teraType: (defSide.isTera && defSide.teraType) ? defSide.teraType : undefined,
  };

  let best = null;
  let bestTotal = Infinity;

  for (let hpEv = 0; hpEv <= 32; hpEv++) {
    if (hpEv > bestTotal) break;
    for (let statEv = 0; statEv <= 32; statEv++) {
      const total = hpEv + statEv;
      if (total > bestTotal) break;
      try {
        const def = new CalcPokemon(GEN, defSide.name, {
          ...defOpts,
          evs: { ...baseEvs, hp: hpEv * 8, [defStat]: statEv * 8 },
        });
        const result = calculate(GEN, atk, def, move, field);
        const dmg = normalizeDamage(result.damage);
        if (!dmg) continue;
        if (dmg[thresholdIdx] < def.stats.hp) {
          // Prefer fewer total pts; on a tie prefer more HP EVs (higher hpEv)
          if (total < bestTotal || hpEv > (best?.hpEv ?? -1)) {
            best = { hpEv, statEv, defStat, nature };
            bestTotal = total;
          }
        }
      } catch { /* skip */ }
    }
  }
  return best;
}

// ── Shared optimizer UI primitives ───────────────────────────────────────────
function BulkRow({ label, value }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12 }}>
      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ color: 'var(--text-primary)' }}>{value}</span>
    </div>
  );
}

// Shows "current → target / 32" with the target in green when it differs
function PtsValue({ current, target }) {
  const changed = target !== current;
  return (
    <span>
      <span style={{ color: 'var(--text-muted)' }}>{current}</span>
      {changed && (
        <>
          <span style={{ color: 'var(--text-muted)', margin: '0 4px' }}>→</span>
          <span style={{ color: '#4ade80', fontWeight: 700 }}>{target}</span>
        </>
      )}
      <span style={{ color: 'var(--text-muted)', fontSize: 10, marginLeft: 3 }}>/ 32</span>
    </span>
  );
}

// ── Bulk Optimizer modal ──────────────────────────────────────────────────────
function BulkSolutionCard({ title, result, currentHpEv, currentStatEv }) {
  const defLabel = result?.defStat === 'def' ? 'Def' : 'SpD';
  const [applied, setApplied] = useState(false);
  useEffect(() => { setApplied(false); }, [result]);

  if (!result) return (
    <div style={{
      flex: 1, borderRadius: 10, border: '1px solid var(--border)',
      padding: 16, display: 'flex', flexDirection: 'column', gap: 6,
      background: 'var(--bg2)', opacity: 0.7,
    }}>
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.06em', color: 'var(--text-muted)' }}>
        {title}
      </span>
      <span style={{ fontSize: 12, color: '#f87171', marginTop: 4 }}>No solution found</span>
      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
        Even 32 HP + 32 {defLabel} pts isn't enough at this threshold
      </span>
    </div>
  );

  const hpChanged   = result.hpEv   !== currentHpEv;
  const statChanged = result.statEv !== currentStatEv;

  return (
    <div style={{
      flex: 1, borderRadius: 10, border: '1px solid var(--border)',
      padding: 16, display: 'flex', flexDirection: 'column', gap: 10,
      background: 'var(--bg1)',
    }}>
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.06em', color: 'var(--text-secondary)' }}>
        {title}
      </span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <BulkRow label="Nature" value={
          <span style={{ color: '#c084fc', fontWeight: 700 }}>{result.nature}</span>
        } />
        <BulkRow label="HP pts"
          value={<PtsValue current={currentHpEv}   target={result.hpEv} />} />
        <BulkRow label={`${defLabel} pts`}
          value={<PtsValue current={currentStatEv} target={result.statEv} />} />
        <BulkRow label="Total pts" value={
          <strong style={{ color: (hpChanged || statChanged) ? '#4ade80' : 'var(--text-primary)' }}>
            {currentHpEv + currentStatEv} → {result.hpEv + result.statEv} / 64
          </strong>
        } />
      </div>
      <button
        onClick={() => { result.onApply(); setApplied(true); }}
        style={{ padding: '6px 12px', fontSize: 12, fontWeight: 600, marginTop: 4,
          background: applied ? 'var(--bg3)' : undefined }}
      >
        {applied ? '✓ Applied' : 'Apply'}
      </button>
    </div>
  );
}

function BulkOptimizerModal({ side, opponent, field, onApply, onClose }) {
  const [thresholdIdx, setThresholdIdx] = useState(15);
  const [solutions, setSolutions]       = useState(null);
  const [computing, setComputing]       = useState(true);

  useEffect(() => {
    setComputing(true);
    setSolutions(null);
    const timer = setTimeout(() => {
      if (!side.name || !opponent.name) {
        setSolutions({ noOpponent: true });
        setComputing(false);
        return;
      }
      const strongest = findStrongestMoveForBulk(opponent, side, field);
      if (!strongest) {
        setSolutions({ noMoves: true });
        setComputing(false);
        return;
      }
      const { moveName, category, dmg, defHP } = strongest;
      const minPct = (dmg[0]  / defHP * 100).toFixed(1);
      const maxPct = (dmg[15] / defHP * 100).toFixed(1);

      // Pick the nature that boosts Def/SpD AND reduces the weaker offensive stat.
      // Equal base Atk/SpA → reduce Spe instead so neither offensive stat is penalised.
      const baseAtk = side.stats?.atk ?? 0;
      const baseSpa = side.stats?.spa ?? 0;
      const phys    = category === 'Physical';
      let chosenNature;
      if (baseAtk > baseSpa)      chosenNature = phys ? 'Impish'  : 'Careful'; // reduce SpA
      else if (baseSpa > baseAtk) chosenNature = phys ? 'Bold'    : 'Calm';    // reduce Atk
      else                        chosenNature = phys ? 'Relaxed' : 'Sassy';   // equal → reduce Spe

      // Neutral card: keep current nature unless it boosts or reduces the defensive stat
      // that matters for this calc (Def for Physical, SpD for Special).
      const defStatKey = phys ? 'def' : 'spd';
      const curNs      = NATURE_STATS[side.nature];
      const curAffects = curNs && (curNs.plus === defStatKey || curNs.minus === defStatKey);
      const neutralNat = (curAffects || !side.nature) ? 'Hardy' : side.nature;

      const defResult     = sweepBulkEvs(opponent, side, moveName, category, thresholdIdx, chosenNature, field);
      const neutralResult = sweepBulkEvs(opponent, side, moveName, category, thresholdIdx, neutralNat, field);

      setSolutions({ moveName, category, minPct, maxPct, defResult, neutralResult, chosenNature, neutralNat });
      setComputing(false);
    }, 0);
    return () => clearTimeout(timer);
  }, [side, opponent, field, thresholdIdx]); // eslint-disable-line react-hooks/exhaustive-deps

  const defLabel = solutions?.defResult?.defStat === 'def' ? 'Def' : 'SpD';

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.65)', display: 'flex',
        alignItems: 'center', justifyContent: 'center',
      }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: 'var(--bg1)', borderRadius: 14, border: '1px solid var(--border)',
        boxShadow: '0 24px 64px rgba(0,0,0,0.6)', width: 500, maxWidth: '95vw',
        padding: 24, display: 'flex', flexDirection: 'column', gap: 20,
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 16, fontWeight: 800 }}>⚡ Bulk Optimizer — {side.name}</span>
          <button onClick={onClose} style={{ fontSize: 18, padding: '2px 8px', lineHeight: 1 }}>×</button>
        </div>

        {/* Threshold selector */}
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.08em', color: 'var(--text-muted)', marginBottom: 8 }}>
            SURVIVAL THRESHOLD
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {THRESHOLD_OPTIONS.map(opt => (
              <button
                key={opt.label}
                onClick={() => setThresholdIdx(opt.idx)}
                style={{
                  flex: 1, padding: '8px 0', fontSize: 12, cursor: 'pointer',
                  fontWeight: thresholdIdx === opt.idx ? 700 : 400,
                  background: thresholdIdx === opt.idx ? 'var(--accent)' : 'var(--bg2)',
                  color: thresholdIdx === opt.idx ? '#fff' : 'var(--text-secondary)',
                  border: '1px solid',
                  borderColor: thresholdIdx === opt.idx ? 'var(--accent)' : 'var(--border)',
                  borderRadius: 8,
                }}
              >
                {opt.label}
                <div style={{ fontSize: 10, fontWeight: 400, opacity: 0.75, marginTop: 2 }}>{opt.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* vs move line */}
        {solutions && !solutions.noMoves && !solutions.noOpponent && (
          <div style={{
            padding: '8px 12px', borderRadius: 8, background: 'var(--bg2)',
            fontSize: 12, color: 'var(--text-secondary)',
          }}>
            <span>Strongest incoming move: </span>
            <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{solutions.moveName}</span>
            <span style={{ color: 'var(--text-muted)', marginLeft: 6 }}>({solutions.category})</span>
            <span> — currently </span>
            <span style={{ color: '#f87171', fontWeight: 700 }}>
              {solutions.minPct}%–{solutions.maxPct}%
            </span>
          </div>
        )}

        {/* States */}
        {computing && (
          <div style={{ textAlign: 'center', fontSize: 13, color: 'var(--text-muted)', padding: '12px 0' }}>
            Computing…
          </div>
        )}
        {solutions?.noOpponent && (
          <div style={{ textAlign: 'center', fontSize: 13, color: 'var(--text-muted)', padding: '12px 0' }}>
            No opponent Pokémon set
          </div>
        )}
        {solutions?.noMoves && (
          <div style={{ textAlign: 'center', fontSize: 13, color: 'var(--text-muted)', padding: '12px 0' }}>
            {opponent.name} has no damaging moves set
          </div>
        )}

        {/* Solution cards */}
        {solutions && !solutions.noMoves && !solutions.noOpponent && !computing && (() => {
          const defStat       = solutions.defResult?.defStat ?? solutions.neutralResult?.defStat ?? 'def';
          const currentHpEv   = side.evs?.hp               ?? 0;
          const currentStatEv = side.evs?.[defStat]        ?? 0;
          return (
            <div style={{ display: 'flex', gap: 12 }}>
              <BulkSolutionCard
                title={solutions.chosenNature ?? (solutions.category === 'Physical' ? '+Def Nature' : '+SpD Nature')}
                result={solutions.defResult ? {
                  ...solutions.defResult,
                  onApply: () => onApply(solutions.defResult),
                } : null}
                currentHpEv={currentHpEv}
                currentStatEv={currentStatEv}
              />
              <BulkSolutionCard
                title={solutions.neutralNat && solutions.neutralNat !== 'Hardy'
                  ? `${solutions.neutralNat} (current)`
                  : 'Hardy (neutral)'}
                result={solutions.neutralResult ? {
                  ...solutions.neutralResult,
                  onApply: () => onApply(solutions.neutralResult),
                } : null}
                currentHpEv={currentHpEv}
                currentStatEv={currentStatEv}
              />
            </div>
          );
        })()}

        <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>
          Sweeps HP × {solutions?.noMoves || solutions?.noOpponent ? 'Def/SpD' : defLabel} (0–32 pts each) · uses the current field effects
        </div>
      </div>
    </div>
  );
}

// ── Damage Optimizer helpers ──────────────────────────────────────────────────
const PLUS_ATK_NATURES = ['Adamant', 'Brave', 'Lonely', 'Naughty'];
const PLUS_SPA_NATURES = ['Modest', 'Quiet', 'Mild', 'Rash'];

// KO threshold: damage[idx] >= defHP means at least (16-idx) rolls KO
const KO_THRESHOLD_OPTIONS = [
  { label: '16/16', idx: 0, desc: 'Always KO' },
  { label: '15/16', idx: 1, desc: '15 out of 16 rolls' },
  { label: '12/16', idx: 4, desc: '12 out of 16 rolls' },
];

// Sweep offensive stat EVs (0–32) to find minimum that achieves the KO threshold.
function sweepDamageEvs(atkSide, defSide, moveName, category, koThresholdIdx, nature, fieldCfg = defaultField()) {
  const def = toCalcPokemon(defSide);
  if (!def) return null;
  let move;
  try {
    move = makeCalcMove(atkSide, moveName);
    if (move.type === undefined) return null;
  } catch { return null; }

  const atkStat = category === 'Physical' ? 'atk' : 'spa';
  const defHP   = def.stats.hp;
  const baseEvs = Object.fromEntries(STAT_KEYS.map(k => [k, (atkSide.evs[k] ?? 0) * 8]));
  const field   = toCalcField(fieldCfg, atkSide, defSide);
  const atkOpts = {
    level:    LEVEL,
    nature,
    item:     resolveItemName(atkSide.item),
    ability:  atkSide.ability  || undefined,
    boosts:   atkSide.boosts,
    status:   atkSide.status   || undefined,
    teraType: (atkSide.isTera && atkSide.teraType) ? atkSide.teraType : undefined,
  };

  for (let statEv = 0; statEv <= 32; statEv++) {
    try {
      const atk = new CalcPokemon(GEN, atkSide.name, {
        ...atkOpts,
        evs: { ...baseEvs, [atkStat]: statEv * 8 },
      });
      const result = calculate(GEN, atk, def, move, field);
      const dmg    = normalizeDamage(result.damage);
      if (!dmg) continue;
      if (dmg[koThresholdIdx] >= defHP) return { statEv, atkStat, nature };
    } catch { /* skip */ }
  }
  return null; // even 32 pts not enough
}

// ── Damage Optimizer modal ────────────────────────────────────────────────────
function DamageSolutionCard({ title, result, currentStatEv }) {
  const atkLabel = result?.atkStat === 'atk' ? 'Atk' : 'SpA';
  const [applied, setApplied] = useState(false);
  useEffect(() => { setApplied(false); }, [result]);

  if (!result) return (
    <div style={{
      flex: 1, borderRadius: 10, border: '1px solid var(--border)',
      padding: 16, display: 'flex', flexDirection: 'column', gap: 6,
      background: 'var(--bg2)', opacity: 0.7,
    }}>
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.06em', color: 'var(--text-muted)' }}>
        {title}
      </span>
      <span style={{ fontSize: 12, color: '#f87171', marginTop: 4 }}>Not achievable</span>
      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
        Even 32 {atkLabel} pts doesn't KO at this threshold
      </span>
    </div>
  );

  return (
    <div style={{
      flex: 1, borderRadius: 10, border: '1px solid var(--border)',
      padding: 16, display: 'flex', flexDirection: 'column', gap: 10,
      background: 'var(--bg1)',
    }}>
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.06em', color: 'var(--text-secondary)' }}>
        {title}
      </span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <BulkRow label="Nature" value={
          <span style={{ color: '#c084fc', fontWeight: 700 }}>{result.nature}</span>
        } />
        <BulkRow label={`${atkLabel} pts`}
          value={<PtsValue current={currentStatEv} target={result.statEv} />} />
      </div>
      <button
        onClick={() => { result.onApply(); setApplied(true); }}
        style={{ padding: '6px 12px', fontSize: 12, fontWeight: 600, marginTop: 4,
          background: applied ? 'var(--bg3)' : undefined }}
      >
        {applied ? '✓ Applied' : 'Apply'}
      </button>
    </div>
  );
}

function DamageOptimizerModal({ side, opponent, field, onApply, onClose }) {
  const [thresholdIdx, setThresholdIdx] = useState(0); // default: 16/16 (always KO)
  const [solutions, setSolutions]       = useState(null);
  const [computing, setComputing]       = useState(true);

  useEffect(() => {
    setComputing(true);
    setSolutions(null);
    const timer = setTimeout(() => {
      if (!side.name || !opponent.name) {
        setSolutions({ noOpponent: true }); setComputing(false); return;
      }
      const strongest = findStrongestMoveForBulk(side, opponent, field);
      if (!strongest) {
        setSolutions({ noMoves: true }); setComputing(false); return;
      }
      const { moveName, category, dmg, defHP } = strongest;
      const minPct = (dmg[0]  / defHP * 100).toFixed(1);
      const maxPct = (dmg[15] / defHP * 100).toFixed(1);

      // Pick the offensive nature that also reduces the weaker of the two offensive stats.
      // If the stat being boosted IS the weaker one, don't penalise the other offensive stat.
      const baseAtk = side.stats?.atk ?? 0;
      const baseSpa = side.stats?.spa ?? 0;
      let chosenNature;
      if (category === 'Physical') {
        // Boost Atk. Reduce SpA only if SpA ≤ Atk (i.e., SpA is the weaker/equal stat).
        chosenNature = baseSpa <= baseAtk ? 'Adamant' : 'Lonely'; // +Atk/-SpA or +Atk/-Def
      } else {
        // Boost SpA. Reduce Atk only if Atk ≤ SpA.
        chosenNature = baseAtk <= baseSpa ? 'Modest' : 'Mild';    // +SpA/-Atk or +SpA/-Def
      }

      // Neutral card: keep current nature unless it boosts or reduces the offensive stat
      // that matters for this calc (Atk for Physical, SpA for Special).
      const atkStatKey = category === 'Physical' ? 'atk' : 'spa';
      const curNs      = NATURE_STATS[side.nature];
      const curAffects = curNs && (curNs.plus === atkStatKey || curNs.minus === atkStatKey);
      const neutralNat = (curAffects || !side.nature) ? 'Hardy' : side.nature;

      const offResult     = sweepDamageEvs(side, opponent, moveName, category, thresholdIdx, chosenNature, field);
      const neutralResult = sweepDamageEvs(side, opponent, moveName, category, thresholdIdx, neutralNat, field);

      setSolutions({ moveName, category, minPct, maxPct, offResult, neutralResult, chosenNature, neutralNat });
      setComputing(false);
    }, 0);
    return () => clearTimeout(timer);
  }, [side, opponent, field, thresholdIdx]); // eslint-disable-line react-hooks/exhaustive-deps

  const atkStat       = (solutions?.offResult ?? solutions?.neutralResult)?.atkStat;
  const currentStatEv = side.evs?.[atkStat ?? 'atk'] ?? 0;

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.65)', display: 'flex',
        alignItems: 'center', justifyContent: 'center',
      }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: 'var(--bg1)', borderRadius: 14, border: '1px solid var(--border)',
        boxShadow: '0 24px 64px rgba(0,0,0,0.6)', width: 500, maxWidth: '95vw',
        padding: 24, display: 'flex', flexDirection: 'column', gap: 20,
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 16, fontWeight: 800 }}>⚔ Damage Optimizer — {side.name}</span>
          <button onClick={onClose} style={{ fontSize: 18, padding: '2px 8px', lineHeight: 1 }}>×</button>
        </div>

        {/* KO threshold selector */}
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.08em', color: 'var(--text-muted)', marginBottom: 8 }}>
            KO THRESHOLD
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {KO_THRESHOLD_OPTIONS.map(opt => (
              <button
                key={opt.label}
                onClick={() => setThresholdIdx(opt.idx)}
                style={{
                  flex: 1, padding: '8px 0', fontSize: 12, cursor: 'pointer',
                  fontWeight: thresholdIdx === opt.idx ? 700 : 400,
                  background: thresholdIdx === opt.idx ? 'var(--accent)' : 'var(--bg2)',
                  color: thresholdIdx === opt.idx ? '#fff' : 'var(--text-secondary)',
                  border: '1px solid',
                  borderColor: thresholdIdx === opt.idx ? 'var(--accent)' : 'var(--border)',
                  borderRadius: 8,
                }}
              >
                {opt.label}
                <div style={{ fontSize: 10, fontWeight: 400, opacity: 0.75, marginTop: 2 }}>{opt.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* vs move info */}
        {solutions && !solutions.noMoves && !solutions.noOpponent && (
          <div style={{
            padding: '8px 12px', borderRadius: 8, background: 'var(--bg2)',
            fontSize: 12, color: 'var(--text-secondary)',
          }}>
            <span>Strongest move vs {opponent.name}: </span>
            <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{solutions.moveName}</span>
            <span style={{ color: 'var(--text-muted)', marginLeft: 6 }}>({solutions.category})</span>
            <span> — currently </span>
            <span style={{
              fontWeight: 700,
              color: parseFloat(solutions.maxPct) >= 100 ? '#4ade80' : '#f87171',
            }}>
              {solutions.minPct}%–{solutions.maxPct}%
            </span>
          </div>
        )}

        {computing && (
          <div style={{ textAlign: 'center', fontSize: 13, color: 'var(--text-muted)', padding: '12px 0' }}>
            Computing…
          </div>
        )}
        {solutions?.noOpponent && (
          <div style={{ textAlign: 'center', fontSize: 13, color: 'var(--text-muted)', padding: '12px 0' }}>
            No opponent Pokémon set
          </div>
        )}
        {solutions?.noMoves && (
          <div style={{ textAlign: 'center', fontSize: 13, color: 'var(--text-muted)', padding: '12px 0' }}>
            {side.name} has no damaging moves set
          </div>
        )}

        {/* Solution cards */}
        {solutions && !solutions.noMoves && !solutions.noOpponent && !computing && (
          <div style={{ display: 'flex', gap: 12 }}>
            <DamageSolutionCard
              title={solutions.chosenNature ?? (solutions.category === 'Physical' ? '+Atk Nature' : '+SpA Nature')}
              result={solutions.offResult ? {
                ...solutions.offResult,
                onApply: () => onApply(solutions.offResult),
              } : null}
              currentStatEv={currentStatEv}
            />
            <DamageSolutionCard
              title={solutions.neutralNat && solutions.neutralNat !== 'Hardy'
                ? `${solutions.neutralNat} (current)`
                : 'Hardy (neutral)'}
              result={solutions.neutralResult ? {
                ...solutions.neutralResult,
                onApply: () => onApply(solutions.neutralResult),
              } : null}
              currentStatEv={currentStatEv}
            />
          </div>
        )}

        <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>
          Sweeps {atkStat === 'atk' ? 'Atk' : 'SpA'} pts (0–32) · uses the current field effects
        </div>
      </div>
    </div>
  );
}

// Build a single-Pokémon Showdown paste from a side state
// EVs are stored as evPoints (0-32); Showdown uses 0-252 → multiply by 8
function buildShowdownPaste(side) {
  const EV_LABELS = { hp: 'HP', atk: 'Atk', def: 'Def', spa: 'SpA', spd: 'SpD', spe: 'Spe' };
  const lines = [];
  lines.push(side.item ? `${side.name} @ ${side.item}` : side.name);
  if (side.ability) lines.push(`Ability: ${side.ability}`);
  if (side.teraType) lines.push(`Tera Type: ${side.teraType}`);
  const evParts = Object.entries(side.evs ?? {})
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${v} ${EV_LABELS[k] ?? k}`);
  if (evParts.length) lines.push(`EVs: ${evParts.join(' / ')}`);
  if (side.nature) lines.push(`${side.nature} Nature`);
  (side.moves ?? []).filter(Boolean).forEach(m => lines.push(`- ${m}`));
  return lines.join('\n');
}

function SidePanel({ label, side, onChange, allNames, activeRegId, opponent, field, selectedSet, onSetChange, lastAppliedRef }) {
  const setSelectedSet = onSetChange;
  const [exportFeedback, setExportFeedback] = useState(''); // '' | 'saved' | 'added' | 'full' | 'copied'
  const [bulkOpen, setBulkOpen]             = useState(false);
  const [dmgOpen,  setDmgOpen]              = useState(false);
  const lastAppliedName  = lastAppliedRef;       // lives in context — survives navigation
  const pendingSetKey    = useRef(null);         // set key to apply after a name-change import
  const prevNameRef      = useRef(side.name);    // initialised with current name — survives StrictMode & remounts
  const { teams, activeTeam, setSlot, patchSlotInTeam } = useTeams();

  // Only fetch meta when the typed name exactly matches a known Pokémon —
  // prevents 404 spam while the user is still mid-typing.
  const nameIsValid = useMemo(
    () => !!side.name && allNames.some(n => n.toLowerCase() === side.name.toLowerCase()),
    [allNames, side.name]
  );

  // Fetch meta for the currently selected Pokémon (same query key as PokemonSlotCard)
  const { data: meta } = useQuery({
    queryKey: ['meta', side.name, activeRegId],
    queryFn:  () => getPokemonMeta(side.name, activeRegId),
    enabled:  nameIsValid && !!activeRegId,
    staleTime: 5 * 60_000,
  });

  // Full legal ability set for the selected Pokémon (from meta.allAbilities).
  // Keep the current value selectable even if it came from an import the list omits.
  const abilityOptions = useMemo(() => {
    const list = meta?.allAbilities ?? [];
    if (side.ability && !list.some(a => a.toLowerCase() === side.ability.toLowerCase())) {
      return [side.ability, ...list];
    }
    return list;
  }, [meta, side.ability]);

  // Build a full side state from the meta "Most Common" spread
  const buildMetaSide = useCallback((metaData, name) => {
    const spread = metaData.spreads?.[0];
    const rawEvs = spread?.evs ?? {};
    return {
      ...defaultSide(),
      name,
      spriteUrl: metaData.spriteUrl ?? '',
      types:     metaData.types     ?? [],
      stats:     metaData.stats     ?? {},
      ability:   metaData.abilities?.[0]?.displayName ?? metaData.abilities?.[0]?.name ?? '',
      item:      metaData.items?.[0]?.displayName ?? metaData.items?.[0]?.name ?? '',
      moves: [
        metaData.moves?.[0]?.displayName ?? metaData.moves?.[0]?.name ?? '',
        metaData.moves?.[1]?.displayName ?? metaData.moves?.[1]?.name ?? '',
        metaData.moves?.[2]?.displayName ?? metaData.moves?.[2]?.name ?? '',
        metaData.moves?.[3]?.displayName ?? metaData.moves?.[3]?.name ?? '',
      ],
      nature: spread?.nature ?? 'Hardy',
      evs: {
        hp:  rawEvs.hp  ?? 0,
        atk: rawEvs.atk ?? 0,
        def: rawEvs.def ?? 0,
        spa: rawEvs.spa ?? 0,
        spd: rawEvs.spd ?? 0,
        spe: rawEvs.spe ?? 0,
      },
    };
  }, []);

  // When the Pokémon name genuinely changes, reset the set selector.
  // Using prevNameRef (initialised to the current name on mount) means this is a no-op on
  // initial mount, StrictMode double-invocations, and navigation remounts — only a real
  // name change ('' → 'Sylveon', 'Sylveon' → 'Garchomp') triggers a reset.
  useEffect(() => {
    const prev = prevNameRef.current;
    prevNameRef.current = side.name;
    if (prev === side.name) return;
    const key = pendingSetKey.current;
    pendingSetKey.current = null;
    setSelectedSet(key ?? 'most-common');
  }, [side.name]);

  // Auto-apply "Most Common" the first time meta loads for a given name
  useEffect(() => {
    if (!meta || !side.name) return;
    if (lastAppliedName.current === side.name) return; // already applied for this name
    lastAppliedName.current = side.name;
    onChange(() => buildMetaSide(meta, side.name));
  }, [meta, side.name]); // eslint-disable-line react-hooks/exhaustive-deps

  // Drop a stale/illegal ability carried in from an imported set — e.g. a team saved
  // before the dex was corrected (Pyroar-Mega "Rivalry" → "Fire Mane"). Only fires
  // once the legal list is known, and only when the current ability isn't legal, so
  // it never overrides a valid choice or wipes the field while meta is still loading.
  useEffect(() => {
    const legal = meta?.allAbilities;
    if (!legal?.length || !side.ability) return;
    if (legal.some(a => a.toLowerCase() === side.ability.toLowerCase())) return;
    onChange(prev => ({ ...prev, ability: legal[0] }));
  }, [meta, side.ability]); // eslint-disable-line react-hooks/exhaustive-deps

  // Build set options: Most Common, team entries, Blank
  const setOptions = useMemo(() => {
    if (!side.name) return [];
    const opts = [{ value: 'most-common', label: 'Most Common' }];
    const nameLower = side.name.toLowerCase();
    teams.forEach(team => {
      const matches = team.slots
        .map((slot, idx) => ({ slot, idx }))
        .filter(({ slot }) => slot?.name?.toLowerCase() === nameLower);
      if (matches.length === 1) {
        opts.push({ value: `team:${team.id}:${matches[0].idx}`, label: `Team · ${team.name}` });
      } else {
        matches.forEach(({ idx }, i) => {
          opts.push({ value: `team:${team.id}:${idx}`, label: `Team · ${team.name} (${i + 1})` });
        });
      }
    });
    opts.push({ value: 'blank', label: 'Blank' });
    return opts;
  }, [side.name, teams]);

  // Apply a preset when the Set dropdown changes
  const handleSetChange = useCallback(value => {
    setSelectedSet(value);
    if (value === 'most-common') {
      if (meta) onChange(() => buildMetaSide(meta, side.name));
    } else if (value === 'blank') {
      onChange(prev => ({ ...defaultSide(), name: prev.name }));
    } else if (value.startsWith('team:')) {
      const [, teamId, slotIdxStr] = value.split(':');
      const team = teams.find(t => t.id === teamId);
      const p    = team?.slots[parseInt(slotIdxStr)];
      if (!p) return;
      onChange(() => ({
        ...defaultSide(),
        name:      p.name,
        spriteUrl: p.spriteUrl ?? '',
        types:     p.types     ?? [],
        stats:     p.stats     ?? {},
        item:      p.item      ?? '',
        ability:   p.ability   ?? '',
        nature:    p.nature    ?? 'Hardy',
        evs:       p.evs       ?? { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
        moves:     p.moves     ?? ['', '', '', ''],
      }));
    }
  }, [meta, side.name, teams, buildMetaSide, onChange]);

  const set = useCallback((key, val) => onChange(prev => ({ ...prev, [key]: val })), [onChange]);

  const EV_CAP = 66;
  const setEv = useCallback((stat, raw) => {
    onChange(prev => {
      const otherTotal = STAT_KEYS.filter(k => k !== stat)
        .reduce((sum, k) => sum + (prev.evs[k] ?? 0), 0);
      const maxForStat = Math.min(32, Math.max(0, EV_CAP - otherTotal));
      const v = Math.min(maxForStat, Math.max(0, parseInt(raw) || 0));
      return { ...prev, evs: { ...prev.evs, [stat]: v } };
    });
  }, [onChange]);

  const setBoost = useCallback((stat, val) => {
    onChange(prev => ({ ...prev, boosts: { ...prev.boosts, [stat]: val } }));
  }, [onChange]);

  const setMove = useCallback((i, val) => {
    onChange(prev => {
      const moves = [...prev.moves]; moves[i] = val;
      return { ...prev, moves };
    });
  }, [onChange]);

  const handleImport = useCallback((pokemon, setKey) => {
    lastAppliedName.current = pokemon.name; // suppress meta auto-apply
    // If the name is changing, the [side.name] effect will fire and consume pendingSetKey.
    // If the name is staying the same (re-import), the effect won't fire so we set it directly.
    pendingSetKey.current = setKey ?? null;
    setSelectedSet(setKey ?? 'most-common');
    onChange(() => ({
      ...defaultSide(),
      name:      pokemon.name,
      spriteUrl: pokemon.spriteUrl ?? '',
      types:     pokemon.types     ?? [],
      stats:     pokemon.stats     ?? {},
      item:      pokemon.item      ?? '',
      ability:   pokemon.ability   ?? '',
      nature:    pokemon.nature    ?? 'Hardy',
      evs:       pokemon.evs       ?? { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
      moves:     pokemon.moves     ?? ['', '', '', ''],
    }));
  }, [onChange]);

  // Save current side state back to the team
  const handleExport = useCallback(() => {
    if (!side.name) return;
    const patch = {
      item:    side.item    ?? '',
      ability: side.ability ?? '',
      nature:  side.nature  ?? 'Hardy',
      evs:     { ...side.evs },
      moves:   [...side.moves],
    };

    if (selectedSet.startsWith('team:')) {
      // Patch the specific slot the Set dropdown is pointing at
      const [, teamId, slotIdxStr] = selectedSet.split(':');
      const slotIdx = parseInt(slotIdxStr);
      patchSlotInTeam(teamId, slotIdx, prev => ({ ...prev, ...patch }));
      setExportFeedback('saved');
    } else {
      // Add to first empty slot of active team
      const emptyIdx = activeTeam?.slots.findIndex(s => s === null);
      if (emptyIdx === -1 || emptyIdx === undefined || !activeTeam) {
        setExportFeedback('full');
        setTimeout(() => setExportFeedback(''), 2000);
        return;
      }
      setSlot(emptyIdx, {
        name:      side.name,
        spriteUrl: side.spriteUrl ?? '',
        types:     side.types     ?? [],
        stats:     side.stats     ?? {},
        ...patch,
      });
      setExportFeedback('added');
    }
    setTimeout(() => setExportFeedback(''), 2000);
  }, [side, selectedSet, teams, activeTeam, setSlot, patchSlotInTeam]);

  // Copy single-Pokémon Showdown paste to clipboard
  const handleCopyShowdown = useCallback(() => {
    if (!side.name) return;
    const paste = buildShowdownPaste(side);
    navigator.clipboard.writeText(paste).then(() => {
      setExportFeedback('copied');
      setTimeout(() => setExportFeedback(''), 2000);
    });
  }, [side]);

  // Apply a bulk optimizer result: set nature + HP/def EVs, zero all others
  // to avoid overcapping the 66-pt total hard cap.
  const handleApplyBulk = useCallback(result => {
    onChange(prev => {
      // Stats set by the optimizer
      const optimizerTotal = result.hpEv + result.statEv;
      // Sum of all OTHER current EVs (the stats the optimizer doesn't touch)
      const otherKeys  = STAT_KEYS.filter(k => k !== 'hp' && k !== result.defStat);
      const otherTotal = otherKeys.reduce((sum, k) => sum + (prev.evs[k] ?? 0), 0);
      // Keep other EVs only if they fit within the 66-pt cap
      const keep = optimizerTotal + otherTotal <= 66;
      return {
        ...prev,
        nature: result.nature,
        evs: {
          hp:  result.hpEv,
          atk: keep ? (prev.evs.atk ?? 0) : 0,
          def: result.defStat === 'def' ? result.statEv : (keep ? (prev.evs.def ?? 0) : 0),
          spa: keep ? (prev.evs.spa ?? 0) : 0,
          spd: result.defStat === 'spd' ? result.statEv : (keep ? (prev.evs.spd ?? 0) : 0),
          spe: keep ? (prev.evs.spe ?? 0) : 0,
        },
      };
    });
  }, [onChange]);

  // Apply a damage optimizer result: set nature + offensive stat EV, keep others if they fit.
  const handleApplyDamage = useCallback(result => {
    onChange(prev => {
      const optimizerTotal = result.statEv;
      const otherKeys  = STAT_KEYS.filter(k => k !== result.atkStat);
      const otherTotal = otherKeys.reduce((sum, k) => sum + (prev.evs[k] ?? 0), 0);
      const keep = optimizerTotal + otherTotal <= 66;
      return {
        ...prev,
        nature: result.nature,
        evs: {
          hp:  keep ? (prev.evs.hp  ?? 0) : 0,
          atk: result.atkStat === 'atk' ? result.statEv : (keep ? (prev.evs.atk ?? 0) : 0),
          def: keep ? (prev.evs.def ?? 0) : 0,
          spa: result.atkStat === 'spa' ? result.statEv : (keep ? (prev.evs.spa ?? 0) : 0),
          spd: keep ? (prev.evs.spd ?? 0) : 0,
          spe: keep ? (prev.evs.spe ?? 0) : 0,
        },
      };
    });
  }, [onChange]);

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.08em', color: 'var(--text-muted)' }}>{label}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {/* Feedback message */}
          {exportFeedback && (
            <span style={{ fontSize: 11, color:
              exportFeedback === 'full'   ? '#f87171' :
              exportFeedback === 'copied' ? '#60a5fa' : '#4ade80',
              fontWeight: 600, whiteSpace: 'nowrap',
            }}>
              {exportFeedback === 'saved'  ? '✓ Saved'       :
               exportFeedback === 'added'  ? '✓ Added to team' :
               exportFeedback === 'full'   ? '✗ Team full'   :
               exportFeedback === 'copied' ? '✓ Copied'      : ''}
            </span>
          )}
          {side.name && (
            <>
              <button
                onClick={handleExport}
                title={selectedSet.startsWith('team:') ? 'Save back to team slot' : 'Add to active team'}
                style={{ fontSize: 11, padding: '4px 10px' }}
              >
                {selectedSet.startsWith('team:') ? 'Save to Team' : 'Add to Team'}
              </button>
              <button
                onClick={handleCopyShowdown}
                title="Copy Showdown paste"
                style={{ fontSize: 11, padding: '4px 8px' }}
              >
                📋
              </button>
            </>
          )}
          <TeamImport onImport={handleImport} />
        </div>
      </div>

      {/* Name */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {side.name && <PokemonImage name={side.name} size={32} />}
        <PokeSearch value={side.name} onChange={v => onChange(prev => ({ ...prev, name: v }))} allNames={allNames} />
      </div>

      {/* Set selector + Bulk Optimizer trigger */}
      {side.name && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
            <SectionLabel style={{ marginBottom: 0 }}>SET</SectionLabel>
            <div style={{ display: 'flex', gap: 4 }}>
              <button
                onClick={() => setBulkOpen(true)}
                style={{ fontSize: 10, padding: '2px 8px', color: '#facc15', borderColor: '#713f12' }}
                title="Find minimum EVs to survive the opponent's strongest move"
              >
                ⚡ Bulk
              </button>
              <button
                onClick={() => setDmgOpen(true)}
                style={{ fontSize: 10, padding: '2px 8px', color: '#f87171', borderColor: '#7f1d1d' }}
                title="Find minimum EVs to KO the opponent with your strongest move"
              >
                ⚔ Dmg
              </button>
            </div>
          </div>
          <select value={selectedSet} onChange={e => handleSetChange(e.target.value)} style={SELECT_STYLE}>
            {setOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
          </select>
        </div>
      )}

      {/* Item + Ability */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        <div>
          <SectionLabel>ITEM</SectionLabel>
          <AutocompleteInput
            value={side.item} onChange={v => set('item', v)} onSelect={v => set('item', v)}
            onKeyDown={() => {}} placeholder="Item…"
            fetchSuggestions={q => getItemSuggestions(q, activeRegId)}
            queryKey={`ci-${activeRegId}`} minChars={2}
          />
        </div>
        <div>
          <SectionLabel>ABILITY</SectionLabel>
          <select
            value={side.ability}
            onChange={e => set('ability', e.target.value)}
            style={SELECT_STYLE}
            disabled={!side.name}
          >
            <option value="">{side.name ? '—' : 'Pick a Pokémon first'}</option>
            {abilityOptions.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
      </div>

      {/* Nature */}
      <div>
        <SectionLabel>NATURE</SectionLabel>
        <select value={side.nature} onChange={e => set('nature', e.target.value)} style={SELECT_STYLE}>
          {NATURES.map(n => {
            const ns = NATURE_STATS[n];
            const label = ns
              ? `${n}  (+${STAT_LABEL[ns.plus]} / −${STAT_LABEL[ns.minus]})`
              : `${n}  (neutral)`;
            return <option key={n} value={n}>{label}</option>;
          })}
        </select>
      </div>

      {/* EVs */}
      <div>
        {(() => {
          const used      = STAT_KEYS.reduce((s, k) => s + (side.evs[k] ?? 0), 0);
          const remaining = 66 - used;
          const color     = remaining === 0 ? '#f87171' : remaining <= 10 ? '#facc15' : 'var(--text-muted)';
          return (
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 5 }}>
              <SectionLabel style={{ marginBottom: 0 }}>EVS (0–32 pts each)</SectionLabel>
              <span style={{ fontSize: 10, fontWeight: 700, color }}>
                {remaining} / 66 left
              </span>
            </div>
          );
        })()}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {STAT_KEYS.map(stat => {
            const ns         = NATURE_STATS[side.nature];
            const isPlus     = ns?.plus  === stat;
            const isMinus    = ns?.minus === stat;
            const accentColor = isPlus ? '#4ade80' : isMinus ? '#f87171' : null;
            const base       = side.stats?.[stat] ?? 0;
            const finalStat  = calcStat(base, side.evs[stat] ?? 0, stat, side.nature);
            return (
              <div key={stat} style={{ display: 'grid', gridTemplateColumns: '30px 1fr 36px', alignItems: 'center', gap: 5 }}>
                {/* Stat label */}
                <span style={{
                  fontSize: 10, fontFamily: 'var(--mono)', fontWeight: accentColor ? 700 : 400,
                  color: accentColor ?? 'var(--text-muted)',
                }}>
                  {STAT_LABEL[stat]}{isPlus ? ' ▲' : isMinus ? ' ▼' : ''}
                </span>
                {/* EV input */}
                <input
                  type="number" min={0} max={32}
                  value={side.evs[stat] || ''}
                  placeholder="0"
                  onChange={e => setEv(stat, e.target.value)}
                  style={{
                    width: '100%', textAlign: 'center', padding: '3px 2px', fontSize: 11,
                    ...(accentColor ? { borderColor: accentColor, color: accentColor } : {}),
                  }}
                />
                {/* Final stat */}
                <span className="mono" style={{
                  fontSize: 12, fontWeight: 700, textAlign: 'right',
                  color: accentColor ?? 'var(--text-primary)',
                }}>
                  {finalStat ?? '—'}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Stat boosts */}
      <div>
        <SectionLabel>STAT BOOSTS</SectionLabel>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {BOOST_STATS.map(stat => (
            <div key={stat} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
              <span style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'var(--mono)' }}>{STAT_LABEL[stat]}</span>
              <BoostControl value={side.boosts[stat] ?? 0} onChange={v => setBoost(stat, v)} />
            </div>
          ))}
        </div>
      </div>

      {/* Status */}
      <div>
        <SectionLabel>STATUS</SectionLabel>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {STATUSES.map(s => (
            <Chip key={s} label={STATUS_LABEL[s]} active={side.status === s}
              onClick={() => set('status', s)} color={STATUS_COLOR[s]} />
          ))}
        </div>
      </div>

      {/* Tera */}
      <div>
        <SectionLabel>TERA TYPE</SectionLabel>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <Chip label={side.isTera ? 'Tera ON' : 'Tera OFF'} active={side.isTera}
            onClick={() => set('isTera', !side.isTera)} />
          {side.isTera && (
            <select value={side.teraType} onChange={e => set('teraType', e.target.value)}
              style={{ ...SELECT_STYLE, width: 'auto', padding: '3px 8px', fontSize: 11 }}>
              <option value="">— type —</option>
              {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          )}
        </div>
      </div>

      {/* Side effects */}
      <div>
        <SectionLabel>SIDE CONDITIONS</SectionLabel>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          <Chip label="Tailwind"     active={side.isTailwind}    onClick={() => set('isTailwind',    !side.isTailwind)}    color="#6890f0" />
          <Chip label="Helping Hand" active={side.isHelpingHand} onClick={() => set('isHelpingHand', !side.isHelpingHand)} color="#4ade80" />
          <Chip label="Reflect"      active={side.isReflect}     onClick={() => set('isReflect',     !side.isReflect)}     color="#f97316" />
          <Chip label="Light Screen" active={side.isLightScreen} onClick={() => set('isLightScreen', !side.isLightScreen)} color="#facc15" />
          <Chip label="Aurora Veil"  active={side.isAuroraVeil}  onClick={() => set('isAuroraVeil',  !side.isAuroraVeil)}  color="#a78bfa" />
        </div>
      </div>

      {/* Moves */}
      <div>
        <SectionLabel>MOVES</SectionLabel>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {side.moves.map((m, i) => (
            <AutocompleteInput
              key={i}
              value={m}
              onChange={v => setMove(i, v)}
              onSelect={v => setMove(i, v)}
              onKeyDown={() => {}}
              placeholder={`Move ${i + 1}…`}
              fetchSuggestions={q => getMoveSuggestions(q, activeRegId, side.name)}
              queryKey={`cm-${activeRegId}-${side.name}-${i}`}
              minChars={2}
            />
          ))}
        </div>
      </div>

      {/* Bulk Optimizer modal */}
      {bulkOpen && (
        <BulkOptimizerModal
          side={side}
          opponent={opponent}
          field={field}
          onApply={result => { handleApplyBulk(result); }}
          onClose={() => setBulkOpen(false)}
        />
      )}

      {/* Damage Optimizer modal */}
      {dmgOpen && (
        <DamageOptimizerModal
          side={side}
          opponent={opponent}
          field={field}
          onApply={result => { handleApplyDamage(result); }}
          onClose={() => setDmgOpen(false)}
        />
      )}
    </div>
  );
}

// ── Result row ────────────────────────────────────────────────────────────────
// Split "guaranteed 2HKO after Leftovers recovery" → { koPart, afterPart }
function parseKoDesc(koDesc) {
  if (!koDesc) return { koPart: null, afterPart: null };
  const m = koDesc.match(/^(.+?)\s+after\s+(.+)$/i);
  return m ? { koPart: m[1], afterPart: m[2] } : { koPart: koDesc, afterPart: null };
}

// Badge colour: green for recovery, amber for damage-reducing berries
function afterBadgeStyle(afterPart) {
  const lower = (afterPart ?? '').toLowerCase();
  const isRecovery = lower.includes('recovery') || lower.includes('leftovers') || lower.includes('black sludge');
  const color  = isRecovery ? '#4ade80' : '#fb923c';
  return {
    fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 5,
    background: `color-mix(in srgb, ${color} 15%, transparent)`,
    color,
    border: `1px solid color-mix(in srgb, ${color} 35%, transparent)`,
    whiteSpace: 'nowrap',
  };
}

// Effective base power badge — green when a field/condition boosted it,
// red when reduced, neutral when unchanged. Tooltip shows the move's base BP.
function BpBadge({ bp, baseBP }) {
  if (!bp) return null;
  const boosted = bp > baseBP, reduced = bp < baseBP;
  const color = boosted ? '#4ade80' : reduced ? '#f87171' : 'var(--text-muted)';
  return (
    <span
      title={bp !== baseBP ? `Base ${baseBP} BP → ${bp} BP (field/condition)` : `${bp} BP`}
      style={{
        flexShrink: 0, fontFamily: 'var(--mono)', fontSize: 10, fontWeight: 700,
        padding: '1px 6px', borderRadius: 5, color,
        border: `1px solid ${bp !== baseBP ? color : 'var(--border)'}`,
        background: bp !== baseBP ? `color-mix(in srgb, ${color} 14%, transparent)` : 'var(--bg2)',
      }}
    >
      {bp} BP
    </span>
  );
}

// Editable BP control for counter-based moves (Last Respects, Rage Fist).
// Steps by `info.step`, clamped to [info.base, info.max]; reports the new BP up.
function EditableBpBadge({ value, info, onChange }) {
  const cur     = value ?? info.base;
  const accent  = 'var(--accent)';
  const boosted = cur > info.base;
  const set = v => onChange(Math.max(info.base, Math.min(info.max, v)));
  const btn = {
    width: 16, height: 16, padding: 0, fontSize: 12, lineHeight: 1,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: accent, fontWeight: 700, background: 'transparent', border: 'none', cursor: 'pointer',
  };
  return (
    <span
      title={`${info.hint} · click ± to adjust (max ${info.max})`}
      style={{
        flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 1,
        fontFamily: 'var(--mono)', fontSize: 10, fontWeight: 700,
        padding: '0 3px', borderRadius: 5, color: boosted ? '#4ade80' : accent,
        border: `1px solid ${boosted ? '#4ade80' : accent}`,
        background: `color-mix(in srgb, ${boosted ? '#4ade80' : accent} 14%, transparent)`,
      }}
    >
      <button onClick={() => set(cur - info.step)} disabled={cur <= info.base}
        style={{ ...btn, opacity: cur <= info.base ? 0.35 : 1 }}>−</button>
      <span style={{ minWidth: 34, textAlign: 'center' }}>{cur} BP</span>
      <button onClick={() => set(cur + info.step)} disabled={cur >= info.max}
        style={{ ...btn, opacity: cur >= info.max ? 0.35 : 1 }}>+</button>
    </span>
  );
}

function ResultRow({ result, onSetBp }) {
  const [showRolls, setShowRolls] = useState(false);
  if (!result) return null;
  const { moveName, error, minPct, maxPct, koDesc, rolls, bp, baseBP, varBp } = result;
  const { koPart, afterPart } = parseKoDesc(koDesc);

  const baseStyle = {
    padding: '10px 14px', borderBottom: '1px solid var(--border)',
  };

  if (error) return (
    <div style={{ ...baseStyle, display: 'flex', alignItems: 'center', gap: 12 }}>
      <span className="calc-move-name" style={{ fontSize: 13, fontWeight: 600, minWidth: 160, color: 'var(--text-primary)' }}>{moveName}</span>
      <span style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>Unknown move</span>
    </div>
  );

  if (result.immune) return (
    <div style={{ ...baseStyle, display: 'flex', alignItems: 'center', gap: 12 }}>
      <span className="calc-move-name" style={{ fontSize: 13, fontWeight: 600, minWidth: 160, color: 'var(--text-primary)' }}>{moveName}</span>
      <span style={{ fontSize: 12, color: '#60a5fa', fontWeight: 600 }}>Immune — no effect</span>
    </div>
  );

  if (minPct === null) return (
    <div style={{ ...baseStyle, display: 'flex', alignItems: 'center', gap: 12, color: 'var(--text-muted)', fontSize: 12 }}>
      <span className="calc-move-name" style={{ fontWeight: 600, minWidth: 160, color: 'var(--text-secondary)' }}>{moveName}</span>
      <span>— status / non-damaging move</span>
    </div>
  );

  const avg      = (minPct + maxPct) / 2;
  const barColor = avg >= 100 ? '#f87171' : avg >= 50 ? '#fb923c' : avg >= 33 ? '#facc15' : '#4ade80';
  const koCount  = rolls ? rolls.filter(r => r >= 100).length : 0;

  return (
    <div style={baseStyle}>
      {/* Main result line */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span className="calc-move-name" style={{ fontSize: 13, fontWeight: 600, minWidth: 160, color: 'var(--text-primary)', flexShrink: 0 }}>
          {moveName}
        </span>
        {varBp
          ? <EditableBpBadge value={bp} info={varBp} onChange={v => onSetBp(moveName, v)} />
          : <BpBadge bp={bp} baseBP={baseBP} />}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 3, flexWrap: 'wrap' }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 14, fontWeight: 800, color: barColor }}>
              {minPct.toFixed(1)}% – {maxPct.toFixed(1)}%
            </span>
            {koPart && (
              <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 600 }}>
                — {koPart}
              </span>
            )}
            {afterPart && (
              <span style={afterBadgeStyle(afterPart)}>
                after {afterPart}
              </span>
            )}
          </div>
          <div style={{ height: 3, background: 'var(--bg3)', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{ height: '100%', borderRadius: 2, background: barColor, width: `${Math.min(100, maxPct)}%`, opacity: 0.65 }} />
          </div>
        </div>
        {/* Roll toggle */}
        {rolls && (
          <button
            onClick={() => setShowRolls(v => !v)}
            style={{
              flexShrink: 0, padding: '2px 8px', fontSize: 10, fontFamily: 'var(--mono)',
              color: showRolls ? 'var(--accent)' : 'var(--text-muted)',
              border: `1px solid ${showRolls ? 'var(--accent)' : 'var(--border)'}`,
              borderRadius: 5, cursor: 'pointer',
              background: showRolls ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'var(--bg2)',
            }}
          >
            {showRolls ? '▴' : '▾'} rolls
            {koCount > 0 && (
              <span style={{ marginLeft: 4, color: '#f87171', fontWeight: 700 }}>
                {koCount}/16
              </span>
            )}
          </button>
        )}
      </div>

      {/* 16-roll table */}
      {showRolls && rolls && (
        <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 3 }}>
          {rolls.map((pct, i) => {
            const isKo    = pct >= 100;
            const rollAvg = pct;
            const col     = isKo ? '#f87171' : rollAvg >= 50 ? '#fb923c' : rollAvg >= 33 ? '#facc15' : '#4ade80';
            return (
              <div key={i} style={{
                fontFamily: 'var(--mono)', fontSize: 10, textAlign: 'center',
                padding: '3px 2px', borderRadius: 4,
                background: isKo ? 'rgba(248,113,113,0.12)' : 'var(--bg3)',
                color: col,
                fontWeight: isKo ? 700 : 400,
                border: `1px solid ${isKo ? 'rgba(248,113,113,0.35)' : 'transparent'}`,
              }}>
                {pct}%
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Results section ───────────────────────────────────────────────────────────
function ResultsSection({ left, right, field, setLeft, setRight }) {
  const setBp = (setSide) => (moveName, val) =>
    setSide(s => ({ ...s, bpOverrides: { ...s.bpOverrides, [_toId(moveName)]: val } }));

  const results = useMemo(() => {
    if (!left.name || !right.name) return null;
    return {
      lr: left.moves.filter(Boolean).map(m => runCalc(left, right, m, field)),
      rl: right.moves.filter(Boolean).map(m => runCalc(right, left, m, field)),
    };
  }, [left, right, field]);

  if (!results) {
    return (
      <div style={{
        gridColumn: '1 / -1', fontSize: 13, color: 'var(--text-muted)',
        padding: '20px 0', textAlign: 'center',
      }}>
        Fill in both Pokémon to see damage results
      </div>
    );
  }

  const ResultBlock = ({ rows, atkName, defName, onSetBp }) => (
    <div style={{ borderRadius: 10, border: '1px solid var(--border)', overflow: 'hidden' }}>
      <div style={{
        padding: '8px 14px', background: 'var(--bg2)', borderBottom: '1px solid var(--border)',
        fontSize: 11, fontWeight: 700, letterSpacing: '.07em', color: 'var(--text-muted)',
      }}>
        {atkName.toUpperCase()} → {defName.toUpperCase()}
      </div>
      {rows.length > 0
        ? rows.map((r, i) => <ResultRow key={i} result={r} onSetBp={onSetBp} />)
        : <div style={{ padding: '12px 14px', fontSize: 12, color: 'var(--text-muted)' }}>No moves set</div>
      }
    </div>
  );

  return (
    <>
      <ResultBlock rows={results.lr} atkName={left.name}  defName={right.name} onSetBp={setBp(setLeft)}  />
      <ResultBlock rows={results.rl} atkName={right.name} defName={left.name}  onSetBp={setBp(setRight)} />
    </>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function Calculator() {
  const { activeRegId } = useRegulation();
  const { left, setLeft, right, setRight, field, setField, leftSet, setLeftSet, rightSet, setRightSet, leftLastApplied, rightLastApplied } = useCalculatorState();

  const { data: usageList = [] } = useQuery({
    queryKey: ['usage', activeRegId],
    queryFn:  () => getUsage(activeRegId),
    enabled:  !!activeRegId,
  });
  const allNames = useMemo(() => usageList.map(p => p.name), [usageList]);

  const swap = () => {
    setLeft(l => { setRight(l); return right; });
  };

  return (
    <div>
      {/* Page header */}
      <div style={{ marginBottom: 20, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-.02em' }}>Calculator</h1>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>
            VGC damage calculator · Lv 50 · Doubles · Gen 9
          </p>
        </div>
        <button
          onClick={() => { const tmp = left; setLeft(right); setRight(tmp); }}
          style={{ padding: '8px 16px', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0, marginTop: 4 }}
        >
          ⇄ Swap
        </button>
      </div>

      {/* Global field effects */}
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center',
        padding: '10px 14px', borderRadius: 10,
        border: '1px solid var(--border)', background: 'var(--bg2)', marginBottom: 20,
      }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.08em', color: 'var(--text-muted)', marginRight: 4 }}>
          FIELD
        </span>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {WEATHERS.map(w => (
            <Chip key={w} label={w || 'Clear'} active={field.weather === w}
              onClick={() => setField(f => ({ ...f, weather: w }))} color={WEATHER_COLOR[w]} />
          ))}
        </div>
        <div style={{ width: 1, height: 20, background: 'var(--border)', flexShrink: 0 }} />
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {TERRAINS.map(t => (
            <Chip key={t} label={t || 'No terrain'} active={field.terrain === t}
              onClick={() => setField(f => ({ ...f, terrain: t }))} color={TERRAIN_COLOR[t]} />
          ))}
        </div>
      </div>

      {/* Two-column grid shared by results (top) and panels (bottom) */}
      <div className="stack-mobile" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>

        {/* Results row */}
        <ResultsSection left={left} right={right} field={field} setLeft={setLeft} setRight={setRight} />

        {/* Panels row */}
        <SidePanel label="LEFT"  side={left}  onChange={setLeft}  allNames={allNames} activeRegId={activeRegId} opponent={right} field={field} selectedSet={leftSet}  onSetChange={setLeftSet}  lastAppliedRef={leftLastApplied} />
        <SidePanel label="RIGHT" side={right} onChange={setRight} allNames={allNames} activeRegId={activeRegId} opponent={left}  field={field} selectedSet={rightSet} onSetChange={setRightSet} lastAppliedRef={rightLastApplied} />

      </div>
    </div>
  );
}
