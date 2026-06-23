// src/pages/AccuracyCheck.jsx
// Accuracy Check — hit-chance calculator with stage + item/ability modifiers.
// Pure frontend: move accuracy comes from /moves/details (reg-aware Champions overrides).
import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getMoveSuggestions, getMoveDetails } from '../lib/api';
import { useRegulation } from '../lib/RegulationContext';
import { AutocompleteInput } from '../components/AutocompleteInput';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Net accuracy/evasion stage → multiplier (3/(3+|s|) below 0, (3+s)/3 above)
function stageMult(stage) {
  return stage >= 0 ? (3 + stage) / 3 : 3 / (3 - stage);
}

// Binomial: with single-hit probability p over n independent uses, return
// exact[k] = P(exactly k hits) and atLeast[k] = P(k or more hits), k = 0…n.
function binomialDist(p, n) {
  const exact = new Array(n + 1).fill(0);
  let coef = 1; // C(n,k), built multiplicatively
  for (let k = 0; k <= n; k++) {
    exact[k] = coef * Math.pow(p, k) * Math.pow(1 - p, n - k);
    coef = (coef * (n - k)) / (k + 1);
  }
  const atLeast = new Array(n + 1).fill(0);
  let acc = 0;
  for (let k = n; k >= 0; k--) { acc += exact[k]; atLeast[k] = acc; }
  return { exact, atLeast };
}

// Multi-accuracy moves (Triple Axel, Triple Kick, Population Bomb): each strike
// rolls accuracy independently and the move STOPS on the first miss. So landing
// k strikes needs k consecutive hits → atLeast[k] = p^k.
function sequentialDist(p, n) {
  const atLeast = new Array(n + 1).fill(0);
  for (let k = 0; k <= n; k++) atLeast[k] = Math.pow(p, k);
  const exact = new Array(n + 1).fill(0);
  for (let k = 0; k < n; k++) exact[k] = atLeast[k] - atLeast[k + 1]; // p^k(1-p)
  exact[n] = atLeast[n];                                              // p^n
  const expected = atLeast.slice(1).reduce((a, b) => a + b, 0);      // Σ p^k, k=1…n
  return { exact, atLeast, expected };
}

const MAX_ATTEMPTS = 10;

const chanceColor = c => c >= 99.99 ? '#4ade80' : c >= 85 ? '#a3e635' : c >= 60 ? '#facc15' : '#f87171';
const fmtPct = x => (x * 100).toFixed(1).replace(/\.0$/, '');

// Shared distribution table: one row per count k (1…n) with cumulative (≥k) and
// exact probabilities, plus a trailing 0-count row.
function DistRows({ n, atLeast, exact, unit, zeroDesc }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {Array.from({ length: n }, (_, i) => i + 1).map(k => {
        const al = atLeast[k] * 100, ex = exact[k] * 100, allK = k === n;
        return (
          <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 12, minWidth: 78, color: 'var(--text-secondary)' }}>
              {allK ? `all ${k}` : `≥ ${k}`} <span style={{ color: 'var(--text-muted)' }}>of {n}</span>
            </span>
            <div style={{ flex: 1, height: 8, background: 'var(--bg3)', borderRadius: 4, overflow: 'hidden' }}>
              <div style={{ height: '100%', borderRadius: 4, width: `${al}%`, background: chanceColor(al), opacity: 0.7 }} />
            </div>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 800, minWidth: 56, textAlign: 'right', color: chanceColor(al) }}>
              {fmtPct(atLeast[k])}%
            </span>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-muted)', minWidth: 90, textAlign: 'right' }}>
              exactly {fmtPct(exact[k])}%
            </span>
          </div>
        );
      })}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, borderTop: '1px solid var(--border)', marginTop: 2, paddingTop: 6 }}>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 12, minWidth: 78, color: 'var(--text-muted)' }}>0 {unit}</span>
        <span style={{ flex: 1, fontSize: 11, color: 'var(--text-muted)' }}>{zeroDesc}</span>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text-muted)', minWidth: 56, textAlign: 'right' }}>
          {fmtPct(exact[0])}%
        </span>
        <span style={{ minWidth: 90 }} />
      </div>
    </div>
  );
}

// ── Modifier catalogue ────────────────────────────────────────────────────────
// physicalOnly: only applies to physical moves (Hustle).
const ATK_ABILITIES = [
  { key: 'compoundEyes', label: 'Compound Eyes', mult: 1.3 },
  { key: 'victoryStar',  label: 'Victory Star',  mult: 1.1, note: 'user or ally' },
  { key: 'hustle',       label: 'Hustle',        mult: 0.8, physicalOnly: true, note: 'physical moves' },
  { key: 'noGuard',      label: 'No Guard',      always: true, note: 'always hits' },
];
const ATK_ITEMS = [
  { key: 'wideLens', label: 'Wide Lens',   mult: 1.1 },
  { key: 'zoomLens', label: 'Zoom Lens',   mult: 1.2, note: 'if you move last' },
  { key: 'micle',    label: 'Micle Berry', mult: 1.2, note: 'next move' },
];
const ATK_FIELD = [
  { key: 'gravity', label: 'Gravity', mult: 5 / 3 },
];
const TGT_ABILITIES = [
  { key: 'sandVeil',    label: 'Sand Veil',    mult: 0.8, note: 'in sand' },
  { key: 'snowCloak',   label: 'Snow Cloak',   mult: 0.8, note: 'in snow' },
  { key: 'tangledFeet', label: 'Tangled Feet', mult: 0.5, note: 'while confused' },
  { key: 'noGuard',     label: 'No Guard',     always: true, note: 'always hits' },
];
const TGT_ITEMS = [
  { key: 'brightPowder', label: 'Bright Powder', mult: 0.9 },
  { key: 'laxIncense',   label: 'Lax Incense',   mult: 0.9 },
];

const fmtMult = m => `×${Number(m.toFixed(2))}`;

// ── Toggle chip ───────────────────────────────────────────────────────────────
function ModChip({ mod, active, disabled, onToggle }) {
  const color = mod.always ? '#c084fc' : mod.mult >= 1 ? '#4ade80' : '#f87171';
  return (
    <button
      onClick={onToggle}
      disabled={disabled}
      title={mod.note ?? ''}
      style={{
        padding: '5px 10px', borderRadius: 7, fontSize: 11.5, cursor: disabled ? 'not-allowed' : 'pointer',
        fontFamily: 'var(--mono)', fontWeight: active ? 700 : 500, textAlign: 'left',
        opacity: disabled ? 0.4 : 1,
        background: active ? `color-mix(in srgb, ${color} 18%, transparent)` : 'var(--bg2)',
        border: `1px solid ${active ? color : 'var(--border)'}`,
        color: active ? color : 'var(--text-secondary)',
        display: 'flex', flexDirection: 'column', gap: 1, minWidth: 116,
      }}
    >
      <span>{mod.label}</span>
      <span style={{ fontSize: 9.5, opacity: 0.85, fontWeight: 600 }}>
        {mod.always ? 'always hits' : fmtMult(mod.mult)}{mod.note ? ` · ${mod.note}` : ''}
      </span>
    </button>
  );
}

// ── Stage control (−6…+6) ─────────────────────────────────────────────────────
function StageControl({ label, value, onChange }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
      <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <button onClick={() => onChange(clamp(value - 1, -6, 6))}
          style={{ width: 22, height: 22, padding: 0, fontSize: 13, color: '#f87171', fontWeight: 700 }}>−</button>
        <span style={{
          fontFamily: 'var(--mono)', fontSize: 13, minWidth: 28, textAlign: 'center',
          color: value > 0 ? '#4ade80' : value < 0 ? '#f87171' : 'var(--text-muted)', fontWeight: value !== 0 ? 700 : 400,
        }}>{value > 0 ? `+${value}` : value}</span>
        <button onClick={() => onChange(clamp(value + 1, -6, 6))}
          style={{ width: 22, height: 22, padding: 0, fontSize: 13, color: '#4ade80', fontWeight: 700 }}>+</button>
      </div>
    </div>
  );
}

function Group({ title, children }) {
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.08em', color: 'var(--text-muted)', marginBottom: 6 }}>
        {title}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{children}</div>
    </div>
  );
}

const PANEL = {
  background: 'var(--bg1)', border: '1px solid var(--border)', borderRadius: 12,
  padding: 16, display: 'flex', flexDirection: 'column', gap: 16, flex: 1, minWidth: 280,
};

const defaultSide = () => ({ stage: 0 });

// ── Component ──────────────────────────────────────────────────────────────────
export default function AccuracyCheck() {
  const { activeRegId } = useRegulation();
  const [moveInput, setMoveInput] = useState('');
  const [moveName,  setMoveName]  = useState('');
  const [atk, setAtk] = useState({ ...defaultSide() });
  const [tgt, setTgt] = useState({ ...defaultSide() });
  const [attempts, setAttempts] = useState(3);

  const { data: details } = useQuery({
    queryKey: ['moveDetails', moveName],
    queryFn:  () => getMoveDetails([moveName]),
    enabled:  !!moveName,
    staleTime: 5 * 60_000,
  });
  const move = moveName ? details?.[moveName] : null;
  const isPhysical = move?.category === 'Physical';

  const toggle = (setSide, key) => setSide(s => ({ ...s, [key]: !s[key] }));

  const result = useMemo(() => {
    if (!move) return null;
    // accuracy === true (or null) means the move bypasses the accuracy check
    if (move.accuracy === true || move.accuracy == null) {
      return { guaranteed: true, reason: `${move.name ?? moveName} bypasses accuracy checks — it always hits.` };
    }
    if (atk.noGuard || tgt.noGuard) {
      return { guaranteed: true, reason: 'No Guard is in play — this move always hits.' };
    }

    const base = move.accuracy;
    const net  = clamp((atk.stage ?? 0) - (tgt.stage ?? 0), -6, 6);
    const sMult = stageMult(net);

    const rows = [];
    const collect = (side, list) => list.forEach(m => {
      if (m.always || !side[m.key]) return;
      if (m.physicalOnly && !isPhysical) return;
      rows.push({ label: m.label, mult: m.mult });
    });
    collect(atk, ATK_ABILITIES); collect(atk, ATK_ITEMS); collect(atk, ATK_FIELD);
    collect(tgt, TGT_ABILITIES); collect(tgt, TGT_ITEMS);

    let eff = base * sMult;
    rows.forEach(r => { eff *= r.mult; });
    const chance = Math.min(100, eff);
    return { base, net, sMult, rows, eff, chance };
  }, [move, moveName, atk, tgt, isPhysical]);

  // Multi-accuracy moves roll accuracy per strike (number = fixed hit count).
  const mhCount = move?.multiaccuracy && typeof move.multihit === 'number' ? move.multihit : null;

  // Per-strike distribution for multi-accuracy moves (stop-on-miss model).
  const multiHit = useMemo(() => {
    if (!result || !mhCount) return null;
    const p = result.guaranteed ? 1 : result.chance / 100;
    return { p, n: mhCount, ...sequentialDist(p, mhCount) };
  }, [result, mhCount]);

  // Cumulative hit distribution over `attempts` independent uses of the move.
  const multi = useMemo(() => {
    if (!result) return null;
    const p = result.guaranteed ? 1 : result.chance / 100;
    return { p, n: attempts, ...binomialDist(p, attempts) };
  }, [result, attempts]);

  const reset = () => { setAtk({ ...defaultSide() }); setTgt({ ...defaultSide() }); };

  return (
    <div style={{ maxWidth: 920 }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-.02em' }}>Accuracy Check</h1>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>
          Chance to land a move after accuracy/evasion stages and item/ability modifiers.
        </p>
      </div>

      {/* Move picker */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flex: 1, minWidth: 240 }}>
          <AutocompleteInput
            value={moveInput}
            onChange={setMoveInput}
            onSelect={(name) => { setMoveName(name); setMoveInput(name); }}
            placeholder="Move name…"
            fetchSuggestions={(q) => getMoveSuggestions(q, activeRegId)}
            queryKey={`acc-move-${activeRegId}`}
          />
        </div>
        {move && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontFamily: 'var(--mono)', fontSize: 12 }}>
            <span style={{ color: 'var(--text-muted)' }}>Base acc</span>
            <span style={{ fontWeight: 800, fontSize: 15, color: 'var(--text-primary)' }}>
              {move.accuracy === true || move.accuracy == null ? '—' : `${move.accuracy}%`}
            </span>
            {move.category && (
              <span style={{ color: 'var(--text-muted)', textTransform: 'capitalize' }}>· {move.category}</span>
            )}
          </div>
        )}
        <button onClick={reset} style={{ fontSize: 11, padding: '5px 12px' }}>Reset modifiers</button>
      </div>

      {/* Two side panels */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
        <div style={PANEL}>
          <span style={{ fontSize: 13, fontWeight: 800 }}>⚔ Attacker</span>
          <StageControl label="Accuracy stage" value={atk.stage} onChange={v => setAtk(s => ({ ...s, stage: v }))} />
          <Group title="ABILITY">
            {ATK_ABILITIES.map(m => (
              <ModChip key={m.key} mod={m} active={!!atk[m.key]}
                disabled={m.physicalOnly && move && !isPhysical}
                onToggle={() => toggle(setAtk, m.key)} />
            ))}
          </Group>
          <Group title="ITEM">
            {ATK_ITEMS.map(m => (
              <ModChip key={m.key} mod={m} active={!!atk[m.key]} onToggle={() => toggle(setAtk, m.key)} />
            ))}
          </Group>
          <Group title="FIELD">
            {ATK_FIELD.map(m => (
              <ModChip key={m.key} mod={m} active={!!atk[m.key]} onToggle={() => toggle(setAtk, m.key)} />
            ))}
          </Group>
        </div>

        <div style={PANEL}>
          <span style={{ fontSize: 13, fontWeight: 800 }}>🛡 Target</span>
          <StageControl label="Evasion stage" value={tgt.stage} onChange={v => setTgt(s => ({ ...s, stage: v }))} />
          <Group title="ABILITY">
            {TGT_ABILITIES.map(m => (
              <ModChip key={m.key} mod={m} active={!!tgt[m.key]} onToggle={() => toggle(setTgt, m.key)} />
            ))}
          </Group>
          <Group title="ITEM">
            {TGT_ITEMS.map(m => (
              <ModChip key={m.key} mod={m} active={!!tgt[m.key]} onToggle={() => toggle(setTgt, m.key)} />
            ))}
          </Group>
        </div>
      </div>

      {/* Result */}
      {!move && (
        <div style={{ ...PANEL, alignItems: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
          Pick a move to see its hit chance.
        </div>
      )}

      {result?.guaranteed && (
        <div style={{ ...PANEL, gap: 8 }}>
          <span style={{ fontSize: 34, fontWeight: 900, color: '#4ade80' }}>100%</span>
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{result.reason}</span>
        </div>
      )}

      {result && !result.guaranteed && (
        <div style={{ ...PANEL, gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 44, fontWeight: 900, color: chanceColor(result.chance) }}>
              {result.chance.toFixed(1).replace(/\.0$/, '')}%
            </span>
            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              to hit · {(100 - result.chance).toFixed(1).replace(/\.0$/, '')}% to miss
            </span>
            {result.eff > 100 && (
              <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--mono)' }}>
                (effective {result.eff.toFixed(1)}% → capped, guaranteed)
              </span>
            )}
          </div>

          {/* Breakdown */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontFamily: 'var(--mono)', fontSize: 12 }}>
            <BreakRow label="Base accuracy" value={`${result.base}%`} />
            {result.net !== 0 && (
              <BreakRow
                label={`Net stage ${result.net > 0 ? `+${result.net}` : result.net} (acc − eva)`}
                value={`×${result.sMult.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')}`}
                color={result.net > 0 ? '#4ade80' : '#f87171'}
              />
            )}
            {result.rows.map(r => (
              <BreakRow key={r.label} label={r.label} value={`×${r.mult.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')}`}
                color={r.mult >= 1 ? '#4ade80' : '#f87171'} />
            ))}
            <div style={{ borderTop: '1px solid var(--border)', marginTop: 4, paddingTop: 6, display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-secondary)', fontWeight: 700 }}>Effective accuracy</span>
              <span style={{ color: 'var(--text-primary)', fontWeight: 800 }}>{result.eff.toFixed(1)}%</span>
            </div>
          </div>
        </div>
      )}

      {/* Multi-hit (per-strike accuracy, stop-on-miss) */}
      {move && multiHit && (
        <div style={{ ...PANEL, marginTop: 16, gap: 14 }}>
          <div>
            <span style={{ fontSize: 13, fontWeight: 800 }}>🎯 Multi-hit — {move.name ?? moveName}</span>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
              Each of the {multiHit.n} strikes rolls accuracy and the move stops on the first miss
              {' '}· {fmtPct(multiHit.p)}% per strike · expected{' '}
              <span style={{ color: 'var(--text-secondary)', fontWeight: 700 }}>{multiHit.expected.toFixed(2)}</span> strikes.
            </div>
          </div>
          <DistRows n={multiHit.n} atLeast={multiHit.atLeast} exact={multiHit.exact}
            unit="strikes" zeroDesc="first strike misses" />
        </div>
      )}

      {/* Repeated-use distribution (single-hit moves used across multiple turns) */}
      {move && multi && !multiHit && (
        <div style={{ ...PANEL, marginTop: 16, gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <span style={{ fontSize: 13, fontWeight: 800 }}>🎯 Repeated use</span>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                Cumulative chance to land each number of hits across {multi.n} uses
                {' '}at {fmtPct(multi.p)}% each.
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '.06em' }}>USES</span>
              <button onClick={() => setAttempts(a => clamp(a - 1, 1, MAX_ATTEMPTS))}
                style={{ width: 24, height: 24, padding: 0, fontSize: 14, color: '#f87171', fontWeight: 700 }}>−</button>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 15, fontWeight: 800, minWidth: 20, textAlign: 'center' }}>{multi.n}</span>
              <button onClick={() => setAttempts(a => clamp(a + 1, 1, MAX_ATTEMPTS))}
                style={{ width: 24, height: 24, padding: 0, fontSize: 14, color: '#4ade80', fontWeight: 700 }}>+</button>
            </div>
          </div>
          <DistRows n={multi.n} atLeast={multi.atLeast} exact={multi.exact}
            unit="hits" zeroDesc={`all ${multi.n} miss`} />
        </div>
      )}
    </div>
  );
}

function BreakRow({ label, value, color = 'var(--text-primary)' }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ color }}>{value}</span>
    </div>
  );
}
