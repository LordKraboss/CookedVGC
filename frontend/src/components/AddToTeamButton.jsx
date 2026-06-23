// src/components/AddToTeamButton.jsx
// Self-contained "+Add to team" button with smart modal flow.
// Works from any page — manages its own state via useTeams (localStorage-backed).

import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTeams } from '../hooks/useTeams';

// ── Toast notification ────────────────────────────────────────────────────────
const TOAST_STYLES = {
  success: { background: '#14532d', border: '1px solid #4ade80', color: '#dcfce7', icon: '✓' },
  error:   { background: '#450a0a', border: '1px solid #f87171', color: '#fee2e2', icon: '✕' },
};

// toast.message  — plain string (error toasts)
// toast.pokemonName + toast.teamName — structured (success toasts, team name is clickable)
function Toast({ toast, onDone }) {
  const navigate = useNavigate();
  const s = TOAST_STYLES[toast.variant ?? 'success'];

  useEffect(() => {
    const t = setTimeout(onDone, 2500);
    return () => clearTimeout(t);
  }, [onDone]);

  const handleTeamClick = () => {
    onDone();
    navigate('/teams');
  };

  return (
    <div style={{
      position: 'fixed', bottom: 32, left: '50%',
      transform: 'translateX(-50%)',
      background: s.background,
      border: s.border,
      color: s.color,
      borderRadius: 10, padding: '12px 20px',
      fontSize: 13, fontWeight: 600,
      zIndex: 400,
      boxShadow: '0 4px 24px rgba(0,0,0,0.5)',
      whiteSpace: 'nowrap',
      animation: 'fadeInUp .2s ease',
    }}>
      {s.icon}{' '}
      {toast.pokemonName && toast.teamName ? (
        <>
          {toast.pokemonName} has been added to{' '}
          <span
            onClick={handleTeamClick}
            style={{
              textDecoration: 'underline', cursor: 'pointer',
              color: '#86efac',
            }}
          >
            {toast.teamName}
          </span>
        </>
      ) : (
        toast.message
      )}
    </div>
  );
}

// ── Modal overlay / box helpers ───────────────────────────────────────────────
const OVERLAY = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200,
};
const BOX = {
  background: 'var(--bg1)', border: '1px solid var(--border)',
  borderRadius: 16, padding: 24, width: 360,
};

// ── Main component ────────────────────────────────────────────────────────────
export function AddToTeamButton({ pokemon, style = {} }) {
  const { teams, activeTeam, setSlot, newTeam } = useTeams();
  const [modal, setModal] = useState(null);  // null | 'full' | 'replace'
  const [toast, setToast] = useState(null);  // null | toast object

  const showSuccess = useCallback((pokemonName, teamName) => {
    setToast({ variant: 'success', pokemonName, teamName });
  }, []);

  const showError = useCallback((message) => {
    setToast({ variant: 'error', message });
  }, []);

  // ── Core add action ───────────────────────────────────────────────────────
  const doAdd = useCallback((slotIndex, teamName) => {
    setSlot(slotIndex, pokemon);
    setModal(null);
    showSuccess(pokemon.name, teamName);
  }, [pokemon, setSlot, showSuccess]);

  // ── Button click ──────────────────────────────────────────────────────────
  const handleAdd = useCallback((e) => {
    e.stopPropagation();
    if (!activeTeam) return;
    // Duplicate check
    const alreadyIn = activeTeam.slots.some(
      s => s && s.name.toLowerCase() === pokemon.name.toLowerCase()
    );
    if (alreadyIn) {
      showError(`${pokemon.name} is already in ${activeTeam.name}`);
      return;
    }
    const emptyIdx = activeTeam.slots.findIndex(s => s === null);
    if (emptyIdx !== -1) {
      doAdd(emptyIdx, activeTeam.name);
    } else {
      setModal('full');
    }
  }, [activeTeam, pokemon, doAdd, showError]);

  // ── "Create new team" flow ────────────────────────────────────────────────
  // newTeam() and setSlot() both use functional setState updaters that chain
  // through React 18 batching — setSlot receives the state AFTER newTeam ran.
  const handleNewTeam = useCallback(() => {
    const newTeamName = `Team ${teams.length + 1}`;
    newTeam();           // creates new team, makes it active
    setSlot(0, pokemon); // runs against the just-created active team
    setModal(null);
    showSuccess(pokemon.name, newTeamName);
  }, [newTeam, setSlot, pokemon, teams, showSuccess]);

  // ── "Replace" flow ────────────────────────────────────────────────────────
  const handleReplace = useCallback((slotIdx) => {
    doAdd(slotIdx, activeTeam?.name ?? 'your team');
  }, [doAdd, activeTeam]);

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <>
      <button
        className="primary"
        onClick={handleAdd}
        style={{ padding: '5px 10px', fontSize: 12, ...style }}
      >
        + Add
      </button>

      {/* ── Modal ── */}
      {modal && (
        <div style={OVERLAY} onClick={() => setModal(null)}>
          <div style={BOX} onClick={e => e.stopPropagation()}>

            {/* Step 1 — team is full */}
            {modal === 'full' && (
              <>
                <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>
                  "{activeTeam?.name}" is full
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20 }}>
                  What would you like to do with <strong>{pokemon.name}</strong>?
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <button
                    className="primary"
                    onClick={handleNewTeam}
                    style={{ padding: '11px 16px', fontSize: 13 }}
                  >
                    Create a new team
                  </button>
                  <button
                    onClick={() => setModal('replace')}
                    style={{ padding: '11px 16px', fontSize: 13 }}
                  >
                    Replace a Pokémon in this team
                  </button>
                  <button
                    onClick={() => setModal(null)}
                    style={{ padding: '8px 16px', fontSize: 12, color: 'var(--text-muted)' }}
                  >
                    Cancel
                  </button>
                </div>
              </>
            )}

            {/* Step 2 — pick which slot to replace */}
            {modal === 'replace' && (
              <>
                <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>
                  Replace with {pokemon.name}
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
                  Pick which Pokémon to replace:
                </div>
                <div style={{
                  display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)',
                  gap: 8, marginBottom: 16,
                }}>
                  {activeTeam?.slots.map((slot, i) => (
                    <button
                      key={i}
                      onClick={() => slot && handleReplace(i)}
                      disabled={!slot}
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        padding: '12px 8px', minHeight: 52,
                        background: slot ? 'var(--bg2)' : 'var(--bg3)',
                        borderColor: slot ? 'var(--border-hover)' : 'var(--border)',
                        opacity: slot ? 1 : 0.35,
                        cursor: slot ? 'pointer' : 'not-allowed',
                        fontSize: 12, fontWeight: 600,
                        color: 'var(--text-primary)',
                        textAlign: 'center',
                        borderRadius: 8,
                      }}
                    >
                      {slot
                        ? slot.name
                        : <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>Empty</span>
                      }
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => setModal('full')}
                  style={{ width: '100%', fontSize: 12, color: 'var(--text-muted)' }}
                >
                  ← Back
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Toast ── */}
      {toast && <Toast toast={toast} onDone={() => setToast(null)} />}
    </>
  );
}
