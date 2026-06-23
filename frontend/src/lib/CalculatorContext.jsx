// src/lib/CalculatorContext.jsx
// Keeps calculator state alive across route changes.
import { createContext, useContext, useRef, useState } from 'react';

const defaultSide = () => ({
  name: '', item: '', ability: '', nature: 'Hardy',
  evs:    { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
  boosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
  status: '', teraType: '', isTera: false,
  moves:  ['', '', '', ''],
  bpOverrides: {},
  spriteUrl: '', types: [], stats: {},
  isTailwind: false, isHelpingHand: false,
  isReflect: false, isLightScreen: false, isAuroraVeil: false,
});

const defaultField = () => ({ weather: '', terrain: '' });

const CalculatorContext = createContext(null);

export function CalculatorProvider({ children }) {
  const [left,     setLeft]     = useState(defaultSide);
  const [right,    setRight]    = useState(defaultSide);
  const [field,    setField]    = useState(defaultField);
  const [leftSet,  setLeftSet]  = useState('most-common');
  const [rightSet, setRightSet] = useState('most-common');
  const leftLastApplied  = useRef('');
  const rightLastApplied = useRef('');
  return (
    <CalculatorContext.Provider value={{ left, setLeft, right, setRight, field, setField, leftSet, setLeftSet, rightSet, setRightSet, leftLastApplied, rightLastApplied }}>
      {children}
    </CalculatorContext.Provider>
  );
}

export function useCalculatorState() {
  return useContext(CalculatorContext);
}
