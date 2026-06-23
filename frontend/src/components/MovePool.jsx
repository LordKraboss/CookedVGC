// src/components/MovePool.jsx
// Full move pool for a Pokémon with hover tooltips.
// Displayed at the bottom of the MetaAnalysis detail view.

import { useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getPokemonLearnset } from '../lib/api';
import { useTeams } from '../hooks/useTeams';

// ── Constants ─────────────────────────────────────────────────────────────────

const CATEGORY_CONFIG = {
  Physical: { label: 'Physical', color: '#f08030', bg: 'rgba(240,128,48,0.14)' },
  Special:  { label: 'Special',  color: '#6890f0', bg: 'rgba(104,144,240,0.14)' },
  Status:   { label: 'Status',   color: '#a8a878', bg: 'rgba(168,168,120,0.14)' },
};

// Human-readable labels for Showdown move flags
const FLAG_LABELS = {
  contact:     'Makes contact',
  reflectable: 'Bounced by Magic Coat',
  snatch:      'Stolen by Snatch',
  punch:       'Boosted by Iron Fist',
  sound:       'Sound-based',
  powder:      'Powder move',
  bite:        'Boosted by Strong Jaw',
  bullet:      'Blocked by Bulletproof',
  dance:       'Copied by Dancer',
  wind:        'Wind move',
  heal:        'Blocked by Heal Block',
  gravity:     'Blocked by Gravity',
  charge:      'Needs charge turn',
  recharge:    'Needs recharge turn',
};

// ── Category badge ────────────────────────────────────────────────────────────
function CategoryBadge({ category }) {
  const cfg = CATEGORY_CONFIG[category];
  if (!cfg) return null;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      padding: '2px 8px', borderRadius: 99,
      fontSize: 11, fontWeight: 700, fontFamily: 'var(--mono)',
      letterSpacing: '.04em',
      color: cfg.color, background: cfg.bg,
      border: `1px solid ${cfg.color}40`,
    }}>
      {cfg.label}
    </span>
  );
}

// ── Hover tooltip ─────────────────────────────────────────────────────────────
function MoveTooltip({ move, rect }) {
  if (!move || !rect) return null;

  const tipWidth = 240;
  let left = rect.left + rect.width / 2 - tipWidth / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - tipWidth - 8));
  // Show above the chip; if chip is near top of viewport, show below instead
  const spaceAbove = rect.top;
  const top  = spaceAbove > 120 ? rect.top - 8  : rect.bottom + 8;
  const transform = spaceAbove > 120 ? 'translateY(-100%)' : 'none';

  const flags = (move.flags ?? []).filter(f => FLAG_LABELS[f]);
  const power = move.basePower > 0 ? move.basePower : '—';
  const acc   = move.accuracy != null ? `${move.accuracy}` : '—';

  return (
    <div style={{
      position: 'fixed', left, top, transform,
      width: tipWidth,
      background: 'var(--bg1)',
      border: '1px solid var(--border-hover)',
      borderRadius: 10,
      padding: '10px 13px',
      zIndex: 500,
      pointerEvents: 'none',
      boxShadow: '0 6px 24px rgba(0,0,0,0.5)',
    }}>
      {/* Name row: type dot + name + category badge */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 7 }}>
        {move.type && (
          <span style={{
            width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
            background: `var(--t-${move.type}, #888)`,
          }} />
        )}
        <span style={{ fontSize: 13, fontWeight: 700, flex: 1 }}>{move.name}</span>
        <CategoryBadge category={move.category} />
      </div>

      {/* Power · Acc · PP in one compact line */}
      <div style={{
        display: 'flex', gap: 14, marginBottom: 8,
        fontSize: 12, fontFamily: 'var(--mono)',
      }}>
        <span>
          <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>Power </span>
          <strong>{power}</strong>
        </span>
        <span>
          <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>Acc. </span>
          <strong>{acc}</strong>
        </span>
        <span>
          <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>PP </span>
          <strong>{move.pp ?? '—'}</strong>
        </span>
      </div>

      {/* Short description */}
      {move.shortDesc && (
        <p style={{
          fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5,
          marginBottom: flags.length ? 8 : 0,
          fontStyle: 'italic',
        }}>
          {move.shortDesc}
        </p>
      )}

      {/* Flags */}
      {flags.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
          {flags.map(f => (
            <span key={f} style={{
              fontSize: 10, padding: '2px 7px', borderRadius: 99,
              background: 'var(--bg3)', color: 'var(--text-muted)',
              fontFamily: 'var(--mono)', border: '1px solid var(--border)',
            }}>
              {FLAG_LABELS[f]}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Single move chip ──────────────────────────────────────────────────────────
function MoveChip({ move, onMouseEnter, onMouseLeave, onClick, inTeam, isPriority }) {
  const type = move.type ?? 'normal';
  const cursor = inTeam ? 'pointer' : 'default';

  if (isPriority) {
    return (
      <div
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        onClick={onClick}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '5px 12px', borderRadius: 99, cursor,
          background: `var(--t-${type}-bg, rgba(120,200,80,0.15))`,
          border: `1px solid var(--t-${type}, #78c850)`,
        }}
      >
        <span style={{
          width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
          background: `var(--t-${type}, #78c850)`,
        }} />
        <span style={{ fontSize: 12, fontWeight: 600, color: `var(--t-${type}, #78c850)` }}>
          {move.name}
        </span>
        <span style={{
          fontSize: 10, fontWeight: 700, fontFamily: 'var(--mono)',
          color: `var(--t-${type}, #78c850)`, opacity: 0.85,
        }}>
          {move.priority > 0 ? `+${move.priority}` : move.priority}
        </span>
      </div>
    );
  }

  return (
    <div
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '5px 10px', borderRadius: 99, cursor,
        background: 'var(--bg2)', border: '1px solid var(--border)',
        transition: 'border-color .12s',
      }}
      onMouseOver={e => inTeam && (e.currentTarget.style.borderColor = `var(--t-${type}, var(--border-hover))`)}
      onMouseOut={e => (e.currentTarget.style.borderColor = 'var(--border)')}
    >
      <span style={{
        width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
        background: `var(--t-${type}, #888)`,
      }} />
      <span style={{ fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap' }}>
        {move.name}
      </span>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────
export function MovePool({ pokemonName, regId }) {
  const { data: moves = [], isLoading } = useQuery({
    queryKey: ['learnset', pokemonName, regId],
    queryFn: () => getPokemonLearnset(pokemonName, regId),
    enabled: !!pokemonName && !!regId,
  });

  const { activeTeam, setSlot } = useTeams();
  const [tooltip, setTooltip]         = useState(null); // { move, rect }
  const [pendingMove, setPendingMove] = useState(null); // move clicked, waiting for slot pick

  // Find this Pokémon in the active team
  const teamSlotIndex = activeTeam?.slots.findIndex(
    s => s && s.name.toLowerCase() === pokemonName.toLowerCase()
  ) ?? -1;
  const teamPokemon = teamSlotIndex >= 0 ? activeTeam.slots[teamSlotIndex] : null;
  const inTeam = !!teamPokemon;

  const handleEnter  = useCallback((move, e) => {
    setTooltip({ move, rect: e.currentTarget.getBoundingClientRect() });
  }, []);
  const handleLeave  = useCallback(() => setTooltip(null), []);

  const currentMoves = teamPokemon?.moves ?? ['', '', '', ''];

  const handleChipClick = useCallback((move) => {
    if (!inTeam) return;
    setTooltip(null);
    setPendingMove(move);
  }, [inTeam]);

  const handleReplaceMove = useCallback((moveIndex) => {
    // Block if this move already exists in another slot
    const duplicate = currentMoves.some(
      (m, i) => i !== moveIndex && m.toLowerCase() === pendingMove.name.toLowerCase()
    );
    if (duplicate) return;
    setSlot(teamSlotIndex, p => ({
      ...p,
      moves: (p.moves ?? ['', '', '', '']).map((m, i) => i === moveIndex ? pendingMove.name : m),
    }));
    setPendingMove(null);
  }, [setSlot, teamSlotIndex, pendingMove, currentMoves]);

  if (isLoading) return null;
  if (!moves.length) return null;

  const priorityMoves = moves.filter(m => m.priority > 0);
  const negativeMoves = moves.filter(m => m.priority < 0).sort((a, b) => b.priority - a.priority);
  const regularMoves  = moves.filter(m => !(m.priority > 0) && !(m.priority < 0));

  return (
    <div className="card" style={{ marginTop: 16 }}>
      {/* Header */}
      <div style={{
        fontSize: 10, fontWeight: 700, letterSpacing: '.1em',
        textTransform: 'uppercase', color: 'var(--accent)',
        fontFamily: 'var(--mono)', marginBottom: 6,
      }}>
        Move List
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 2 }}>
        <div style={{ fontSize: 18, fontWeight: 800 }}>Moves learned by {pokemonName}</div>
        {inTeam && (
          <span style={{ fontSize: 12, color: 'var(--accent)', fontFamily: 'var(--mono)' }}>
            · click a move to assign it
          </span>
        )}
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 18 }}>
        Curated moves available in Pokémon Champions.
      </div>

      {/* Priority moves */}
      {priorityMoves.length > 0 && (
        <div style={{ marginBottom: 18 }}>
          <div style={{
            fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)',
            fontFamily: 'var(--mono)', marginBottom: 10,
          }}>
            Priority Moves
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {priorityMoves.map(m => (
              <MoveChip
                key={m.name}
                move={m}
                isPriority
                inTeam={inTeam}
                onMouseEnter={e => handleEnter(m, e)}
                onMouseLeave={handleLeave}
                onClick={() => handleChipClick(m)}
              />
            ))}
          </div>
        </div>
      )}

      {/* All other moves */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {regularMoves.map(m => (
          <MoveChip
            key={m.name}
            move={m}
            inTeam={inTeam}
            onMouseEnter={e => handleEnter(m, e)}
            onMouseLeave={handleLeave}
            onClick={() => handleChipClick(m)}
          />
        ))}
      </div>

      {/* Negative priority moves */}
      {negativeMoves.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <div style={{
            fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)',
            fontFamily: 'var(--mono)', marginBottom: 10,
          }}>
            Negative Priority Moves
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {negativeMoves.map(m => (
              <MoveChip
                key={m.name}
                move={m}
                isPriority
                inTeam={inTeam}
                onMouseEnter={e => handleEnter(m, e)}
                onMouseLeave={handleLeave}
                onClick={() => handleChipClick(m)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Tooltip */}
      <MoveTooltip move={tooltip?.move} rect={tooltip?.rect} />

      {/* Move slot picker modal */}
      {pendingMove && (() => {
        const isDuplicate = currentMoves.some(
          m => m.toLowerCase() === pendingMove.name.toLowerCase()
        );
        return (
          <div
            style={{
              position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300,
            }}
            onClick={() => setPendingMove(null)}
          >
            <div
              style={{
                background: 'var(--bg1)', border: '1px solid var(--border)',
                borderRadius: 16, padding: 24, width: 300,
              }}
              onClick={e => e.stopPropagation()}
            >
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>
                Assign — {pendingMove.name}
              </div>

              {isDuplicate ? (
                <div style={{
                  fontSize: 12, color: '#fbbf24',
                  background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.3)',
                  borderRadius: 8, padding: '8px 12px', marginBottom: 16,
                }}>
                  ⚠ {pokemonName} already knows {pendingMove.name}.
                </div>
              ) : (
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 16 }}>
                  Pick which move to replace on {pokemonName}:
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {currentMoves.map((m, i) => {
                  const isThisSlotDuplicate = m.toLowerCase() === pendingMove.name.toLowerCase();
                  return (
                    <button
                      key={i}
                      onClick={() => !isDuplicate && handleReplaceMove(i)}
                      disabled={isDuplicate}
                      style={{
                        padding: '10px 14px', fontSize: 13, textAlign: 'left',
                        background: isThisSlotDuplicate ? 'rgba(251,191,36,0.1)' : 'var(--bg2)',
                        borderColor: isThisSlotDuplicate ? 'rgba(251,191,36,0.4)' : 'var(--border-hover)',
                        borderRadius: 8, fontWeight: 600,
                        opacity: isDuplicate && !isThisSlotDuplicate ? 0.4 : 1,
                        cursor: isDuplicate ? 'default' : 'pointer',
                      }}
                    >
                      {m
                        ? <span style={{ color: isThisSlotDuplicate ? '#fbbf24' : 'inherit' }}>{m}</span>
                        : <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>Empty slot</span>
                      }
                    </button>
                  );
                })}
              </div>

              <button
                onClick={() => setPendingMove(null)}
                style={{ marginTop: 12, width: '100%', fontSize: 12, color: 'var(--text-muted)' }}
              >
                Cancel
              </button>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
