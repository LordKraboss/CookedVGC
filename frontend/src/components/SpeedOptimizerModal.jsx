// src/components/SpeedOptimizerModal.jsx
import { useState, useMemo, useRef, useEffect } from 'react';
import { useTeams } from '../hooks/useTeams';
import { PokemonImage } from './PokemonCard';

// ── Speed math ────────────────────────────────────────────────────────────────
function calcSpe(base, evPoints, nm) {
  const inner = Math.floor(((2 * base + 31 + evPoints * 2) * 50) / 100);
  return Math.floor((inner + 5) * nm);
}

// Modifiers applied in game order: −1 stage → Scarf → Tailwind → Paralysis
function applyMods(speed, { scarf = false, tw = false, para = false, n1 = false }) {
  let s = speed;
  if (n1)    s = Math.floor(s * 2 / 3);
  if (scarf) s = Math.floor(s * 3 / 2);
  if (tw)    s = s * 2;
  if (para)  s = Math.floor(s / 2);
  return s;
}

// Min evPoints (0–32) for the attacker to exceed targetSpeed with a given modifier
function minEv(attackerBase, nm, atkMods, targetSpeed) {
  for (let ev = 0; ev <= 32; ev++) {
    const speed = applyMods(calcSpe(attackerBase, ev, nm), atkMods);
    if (speed > targetSpeed) return { ev, speed };
  }
  return null; // not achievable
}

// ── Attacker build groups ─────────────────────────────────────────────────────
const ATK_GROUPS = [
  { key: 'none',  label: 'Vanilla',      mods: {},              item: '',              bg: 'transparent',            border: 'var(--border)', accent: 'var(--text-secondary)' },
  { key: 'scarf', label: 'Choice Scarf', mods: { scarf: true }, item: 'Choice Scarf', bg: 'rgba(251,191,36,0.10)',  border: '#fbbf24',       accent: '#fbbf24'                },
  { key: 'tw',    label: 'Tailwind',     mods: { tw: true },    item: '',              bg: 'rgba(104,144,240,0.10)', border: '#6890f0',       accent: '#6890f0'                },
];

// Static fallback — dynamic version computed per-attacker below
const NATURE_OPTS_DEFAULT = [
  { nm: 1.1, label: 'Timid / Jolly (+Spe)', nature: 'Timid' },
  { nm: 1.0, label: 'Neutral',               nature: 'Hardy' },
];

// ── Toggle button ─────────────────────────────────────────────────────────────
function Toggle({ label, active, onClick, color = '#6890f0' }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '5px 13px', borderRadius: 8, fontSize: 12, cursor: 'pointer',
        fontFamily: 'var(--mono)', fontWeight: active ? 700 : 400,
        background: active ? `rgba(${hexToRgb(color)},0.14)` : 'var(--bg2)',
        border: `1px solid ${active ? color : 'var(--border)'}`,
        color: active ? color : 'var(--text-muted)',
      }}
    >
      {label}
    </button>
  );
}

function hexToRgb(hex) {
  // handles #rrggbb and named vars by returning a fallback
  const m = hex.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return '128,128,128';
  return `${parseInt(m[1],16)},${parseInt(m[2],16)},${parseInt(m[3],16)}`;
}

// ── Pokémon search input ──────────────────────────────────────────────────────
function PokemonSearch({ value, onChange, onSelect, allNames, placeholder }) {
  const [open,      setOpen]      = useState(false);
  const [focused,   setFocused]   = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const ref = useRef(null);

  const suggestions = useMemo(() => {
    if (!focused || !value) return [];
    const q = value.toLowerCase();
    return allNames.filter(n => n.toLowerCase().includes(q)).slice(0, 8);
  }, [allNames, value, focused]);

  useEffect(() => {
    setActiveIdx(-1);
    setOpen(focused && value.length >= 1 && suggestions.length > 0);
  }, [suggestions, value, focused]);

  useEffect(() => {
    const h = e => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const select = name => { onSelect(name); onChange(name); setOpen(false); };

  const keyDown = e => {
    if (!open) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, suggestions.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, -1)); }
    else if (e.key === 'Enter' && activeIdx >= 0) { e.preventDefault(); select(suggestions[activeIdx]); }
    else if (e.key === 'Escape') setOpen(false);
  };

  return (
    <div ref={ref} style={{ position: 'relative', flex: 1 }}>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={keyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={placeholder ?? 'Search Pokémon…'}
        style={{ width: '100%' }}
      />
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 400,
          background: 'var(--bg1)', border: '1px solid var(--border)',
          borderRadius: 8, overflow: 'hidden', boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
        }}>
          {suggestions.map((name, i) => (
            <div key={name} onMouseDown={() => select(name)} onMouseEnter={() => setActiveIdx(i)}
              style={{
                padding: '9px 14px', fontSize: 13, cursor: 'pointer',
                background: i === activeIdx ? 'var(--accent-dim)' : 'transparent',
                color: i === activeIdx ? 'var(--accent)' : 'var(--text-primary)',
                borderBottom: i < suggestions.length - 1 ? '1px solid var(--border)' : 'none',
              }}>
              {name}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Modal ─────────────────────────────────────────────────────────────────────
// `pokemon`    = the Pokémon you clicked on in the table → the TARGET to outspeed
// `allPokemon` = full list for attacker search
export function SpeedOptimizerModal({ pokemon, allPokemon, onClose }) {
  // ── Target configuration (the clicked Pokémon) ──
  const [tNm,    setTNm]    = useState(1.1);    // nature mult: 1.1 / 1.0 / 0.9
  const [tEv,    setTEv]    = useState(32);     // 0-32 ev points
  const [tMods,  setTMods]  = useState({ scarf: false, tw: false, para: false, n1: false });

  // ── Attacker (the Pokémon you're building) ──
  const [atkInput,   setAtkInput]   = useState('');
  const [atkPokemon, setAtkPokemon] = useState(null);

  // ── Apply feedback ──
  const [confirmCombo, setConfirmCombo] = useState(null);
  const [appliedCombo, setAppliedCombo] = useState(null);

  const { activeTeam, setSlot } = useTeams();

  const targetBase = pokemon.stats?.spe ?? 0;
  const allNames   = useMemo(() => allPokemon.map(p => p.name), [allPokemon]);

  const toggleMod = key =>
    setTMods(prev => ({ ...prev, [key]: !prev[key] }));

  // Live target speed
  const targetSpeed = useMemo(
    () => applyMods(calcSpe(targetBase, tEv, tNm), tMods),
    [targetBase, tEv, tNm, tMods]
  );

  // EV input: clamp to 0-32
  const handleEvChange = raw => {
    const v = Math.min(32, Math.max(0, parseInt(raw) || 0));
    setTEv(v);
  };

  // Pick +Spe nature based on which offensive stat is weaker (to reduce it)
  const natureOpts = useMemo(() => {
    const baseAtk = atkPokemon?.stats?.atk ?? 0;
    const baseSpa = atkPokemon?.stats?.spa ?? 0;
    let speedNature, speedLabel;
    if (!atkPokemon) {
      speedNature = 'Timid';
      speedLabel  = 'Timid / Jolly (+Spe)';
    } else if (baseAtk > baseSpa) {
      speedNature = 'Jolly'; // +Spe/−SpA — reduces the weaker SpA
      speedLabel  = 'Jolly (+Spe / −SpA)';
    } else if (baseSpa > baseAtk) {
      speedNature = 'Timid'; // +Spe/−Atk — reduces the weaker Atk
      speedLabel  = 'Timid (+Spe / −Atk)';
    } else {
      // Equal: neither offensive stat is weaker — default to Timid/Jolly label
      speedNature = 'Timid';
      speedLabel  = 'Timid / Jolly (+Spe)';
    }
    return [
      { nm: 1.1, label: speedLabel,  nature: speedNature },
      { nm: 1.0, label: 'Neutral',   nature: 'Hardy'     },
    ];
  }, [atkPokemon]);

  // Combinations for the attacker
  const combinations = useMemo(() => {
    if (!atkPokemon?.stats?.spe) return [];
    const base = atkPokemon.stats.spe;
    return ATK_GROUPS.map(group => {
      const rows = natureOpts.map(({ nm, label, nature }) => {
        const result = minEv(base, nm, group.mods, targetSpeed);
        return result
          ? { label, nature, evPoints: result.ev, speed: result.speed, groupKey: group.key, item: group.item }
          : null;
      }).filter(Boolean);
      return { ...group, rows };
    }).filter(g => g.rows.length > 0);
  }, [atkPokemon, targetSpeed, natureOpts]);

  // ── Apply to team ──
  const applyCombo = combo => {
    const slotIdx = activeTeam?.slots.findIndex(
      s => s && s.name.toLowerCase() === atkPokemon.name.toLowerCase()
    ) ?? -1;

    if (slotIdx >= 0) {
      setSlot(slotIdx, p => {
        // Keep all non-Spe EVs if they fit within the 66-pt cap alongside the new Spe EVs
        const otherTotal = ['hp', 'atk', 'def', 'spa', 'spd']
          .reduce((sum, k) => sum + (p.evs?.[k] ?? 0), 0);
        const keep = combo.evPoints + otherTotal <= 66;
        return {
          ...p,
          nature: combo.nature,
          evs: {
            hp:  keep ? (p.evs?.hp  ?? 0) : 0,
            atk: keep ? (p.evs?.atk ?? 0) : 0,
            def: keep ? (p.evs?.def ?? 0) : 0,
            spa: keep ? (p.evs?.spa ?? 0) : 0,
            spd: keep ? (p.evs?.spd ?? 0) : 0,
            spe: combo.evPoints,
          },
          ...(combo.item ? { item: combo.item } : {}),
        };
      });
      setAppliedCombo(combo);
      setConfirmCombo(null);
      setTimeout(() => setAppliedCombo(null), 2500);
    } else {
      setConfirmCombo(combo);   // stores the exact combo including groupKey + item
    }
  };

  const confirmAdd = () => {
    if (!confirmCombo || !atkPokemon) return;
    const combo    = confirmCombo;            // capture before clearing
    const slotIdx  = activeTeam?.slots.findIndex(s => s == null) ?? -1;
    setConfirmCombo(null);
    if (slotIdx >= 0) {
      setSlot(slotIdx, {
        name:      atkPokemon.name,
        types:     atkPokemon.types ?? [],
        spriteUrl: atkPokemon.spriteUrl,
        stats:     atkPokemon.stats,
        moves:     ['', '', '', ''],
        ability:   '',
        item:      '',
        usagePct:  atkPokemon.usagePct,
        // PokemonSlotCard will pre-fill from meta — this flag tells it to
        // preserve our speed spread instead of applying the default spread.
        _speedOverride: {
          nature: combo.nature,
          evs:    { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: combo.evPoints },
          ...(combo.item ? { item: combo.item } : {}),
        },
      });
      setAppliedCombo(combo);
      setTimeout(() => setAppliedCombo(null), 2500);
    }
  };

  // ── Render ──
  return (
    <div
      className="spd-overlay"
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.65)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div className="spd-modal" style={{
        background: 'var(--bg1)', border: '1px solid var(--border)', borderRadius: 14,
        width: '100%', maxWidth: 680, maxHeight: '92vh', overflowY: 'auto',
        padding: 28, position: 'relative',
      }}>
        {/* Close */}
        <button onClick={onClose} style={{
          position: 'absolute', top: 16, right: 16,
          width: 28, height: 28, padding: 0,
          background: 'var(--bg3)', border: '1px solid var(--border)',
          borderRadius: 6, cursor: 'pointer', fontSize: 14, color: 'var(--text-muted)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>✕</button>

        {/* ── Header ── */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.09em', color: 'var(--text-muted)', marginBottom: 8 }}>
            OUTSPEED
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <PokemonImage name={pokemon.name} size={52} spriteUrl={pokemon.spriteUrl} />
            <div>
              <div style={{ fontSize: 22, fontWeight: 800 }}>{pokemon.name}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--mono)' }}>
                Base Speed: {targetBase}
              </div>
            </div>
          </div>
        </div>

        {/* ── Target speed configurator ── */}
        <div style={{
          background: 'var(--bg2)', borderRadius: 10, border: '1px solid var(--border)',
          padding: '16px 18px', marginBottom: 24,
        }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.09em', color: 'var(--text-muted)', marginBottom: 12 }}>
            {pokemon.name.toUpperCase()} SPEED SCENARIO
          </div>

          {/* Nature */}
          <div className="spd-rowwrap" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)', minWidth: 56 }}>Nature</span>
            {[
              { nm: 1.1, label: '+Spe',  color: '#4ade80' },
              { nm: 1.0, label: 'Neutral', color: 'var(--text-secondary)' },
              { nm: 0.9, label: '−Spe',  color: '#f87171' },
            ].map(({ nm, label, color }) => (
              <button
                key={nm}
                onClick={() => setTNm(nm)}
                style={{
                  padding: '4px 12px', borderRadius: 8, fontSize: 12, cursor: 'pointer',
                  fontFamily: 'var(--mono)', fontWeight: tNm === nm ? 700 : 400,
                  background: tNm === nm ? 'var(--bg3)' : 'transparent',
                  border: `1px solid ${tNm === nm ? color : 'var(--border)'}`,
                  color: tNm === nm ? color : 'var(--text-muted)',
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {/* EV points */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)', minWidth: 56 }}>EV pts</span>
            <input
              type="number"
              min={0} max={32}
              value={tEv}
              onChange={e => handleEvChange(e.target.value)}
              style={{ width: 64, textAlign: 'center', padding: '4px 6px', fontSize: 13 }}
            />
            <input
              className="spd-ev-slider"
              type="range"
              min={0} max={32} step={1}
              value={tEv}
              onChange={e => setTEv(Number(e.target.value))}
              style={{ flex: 1, accentColor: 'var(--accent)', cursor: 'pointer' }}
            />
            <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--mono)', minWidth: 28 }}>
              {tEv}/32
            </span>
          </div>

          {/* Modifiers */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)', minWidth: 56 }}>Mods</span>
            <Toggle label="Scarf"    active={tMods.scarf} onClick={() => toggleMod('scarf')} color="#fbbf24" />
            <Toggle label="Tailwind" active={tMods.tw}    onClick={() => toggleMod('tw')}    color="#6890f0" />
            <Toggle label="−1 Stage" active={tMods.n1}    onClick={() => toggleMod('n1')}    color="#f87171" />
            <Toggle label="Paralysis" active={tMods.para} onClick={() => toggleMod('para')}  color="#a855f7" />
          </div>

          {/* Live speed result */}
          <div className="spd-rowwrap" style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '10px 14px', borderRadius: 8,
            background: 'var(--bg1)', border: '1px solid var(--border)',
          }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{pokemon.name}'s speed:</span>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 20, fontWeight: 800, color: 'var(--text-primary)' }}>
              {targetSpeed}
            </span>
            <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 8 }}>→ need at least</span>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 20, fontWeight: 800, color: 'var(--accent)' }}>
              {targetSpeed + 1}
            </span>
          </div>
        </div>

        {/* ── Attacker search ── */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.09em', color: 'var(--text-muted)', marginBottom: 10 }}>
            WITH — your pokémon
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            {atkPokemon && (
              <PokemonImage name={atkPokemon.name} size={28} spriteUrl={atkPokemon.spriteUrl} style={{ flexShrink: 0 }} />
            )}
            <PokemonSearch
              value={atkInput}
              onChange={v => { setAtkInput(v); if (!v) setAtkPokemon(null); setConfirmCombo(null); setAppliedCombo(null); }}
              onSelect={name => {
                setAtkInput(name);
                setAtkPokemon(allPokemon.find(p => p.name.toLowerCase() === name.toLowerCase()) ?? null);
                setConfirmCombo(null);
                setAppliedCombo(null);
              }}
              allNames={allNames}
              placeholder="Pick your Pokémon…"
            />
          </div>
        </div>

        {/* ── Results ── */}
        {atkPokemon && (
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.09em', color: 'var(--text-muted)', marginBottom: 12 }}>
              MINIMUM INVESTMENT TO OUTSPEED
            </div>

            {/* Applied flash */}
            {appliedCombo && (
              <div style={{
                marginBottom: 12, padding: '10px 14px', borderRadius: 8,
                background: 'rgba(74,222,128,0.1)', border: '1px solid #4ade8066',
                fontSize: 13, color: '#4ade80', display: 'flex', alignItems: 'center', gap: 8,
              }}>
                ✓ Applied — {appliedCombo.nature} · {appliedCombo.evPoints} Spe pts
                {appliedCombo.item ? ` · Item: ${appliedCombo.item}` : ''} · Speed: {appliedCombo.speed}
              </div>
            )}

            {/* Add-to-team confirm */}
            {confirmCombo && (
              <div style={{
                marginBottom: 12, padding: '14px 16px', borderRadius: 10,
                background: 'var(--bg2)', border: '1px solid var(--border)', fontSize: 13,
              }}>
                <div style={{ marginBottom: 8, fontWeight: 600 }}>
                  {atkPokemon.name} is not in your active team. Add it with this spread?
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--mono)', marginBottom: 12 }}>
                  {confirmCombo.nature} · Spe: {confirmCombo.evPoints} pts · all other EVs: 0
                  {confirmCombo.item ? ` · Item: ${confirmCombo.item}` : ''}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="primary" onClick={confirmAdd}>Add to team</button>
                  <button onClick={() => setConfirmCombo(null)}>Cancel</button>
                </div>
              </div>
            )}

            {combinations.length === 0 && (
              <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '12px 0' }}>
                {atkPokemon.name} cannot outspeed {pokemon.name} in this scenario even at max investment.
              </div>
            )}

            {combinations.map(group => (
              <div key={group.key} style={{
                marginBottom: 10, borderRadius: 10,
                border: `1px solid ${group.border}`,
                overflow: 'hidden',
              }}>
                {/* Group header */}
                <div style={{
                  padding: '8px 14px',
                  background: group.bg === 'transparent' ? 'var(--bg2)' : group.bg.replace(/[\d.]+\)$/, '0.18)'),
                  borderBottom: '1px solid var(--border)',
                  fontSize: 11, fontWeight: 700, letterSpacing: '.07em',
                  color: group.accent,
                }}>
                  {group.label.toUpperCase()}
                </div>

                {/* Combo rows */}
                {group.rows.map((combo, idx) => (
                  <div key={combo.nature} className="spd-combo-row" style={{
                    padding: '11px 14px',
                    display: 'flex', alignItems: 'center', gap: 14,
                    borderBottom: idx < group.rows.length - 1 ? '1px solid var(--border)' : 'none',
                  }}>
                    {/* Nature */}
                    <span className="spd-combo-nature" style={{ fontSize: 13, fontWeight: 600, minWidth: 190 }}>
                      {combo.label}
                    </span>

                    {/* EV pts */}
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 12, minWidth: 70 }}>
                      <span style={{ color: 'var(--text-muted)' }}>Spe: </span>
                      <span style={{ color: 'var(--text-primary)', fontWeight: 700 }}>{combo.evPoints}</span>
                      <span style={{ color: 'var(--text-muted)', fontSize: 10 }}> pts</span>
                    </span>

                    {/* Final speed */}
                    <span style={{
                      fontFamily: 'var(--mono)', fontSize: 15, fontWeight: 800,
                      color: group.accent, minWidth: 54,
                    }}>
                      → {combo.speed}
                    </span>

                    <button
                      className="primary"
                      onClick={() => applyCombo(combo)}
                      style={{ marginLeft: 'auto', fontSize: 12, padding: '5px 14px', flexShrink: 0 }}
                    >
                      Apply
                    </button>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        {!atkPokemon && (
          <div style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center', padding: '8px 0' }}>
            Configure {pokemon.name}'s speed above, then pick your Pokémon to build
          </div>
        )}
      </div>
    </div>
  );
}
