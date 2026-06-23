// frontend/src/lib/RegulationContext.jsx
// Provides the active regulation ID to the whole app.
// Switch reg from anywhere — all React Query keys include regId so caches
// are automatically scoped and don't bleed between regulations.

import { createContext, useContext, useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { getRegulations } from "./api";

const RegCtx = createContext(null);

export function RegulationProvider({ children }) {
  const { data: regs = [] } = useQuery({
    queryKey: ["regulations"],
    queryFn: getRegulations,
    staleTime: 60_000,
  });

  const defaultReg = regs.find((r) => r.active)?.id ?? regs[0]?.id ?? "regma";
  const [activeRegId, setActiveRegId] = useState(() => {
    return localStorage.getItem("vgc_active_reg") ?? null;
  });

  // Once regs load, fallback to active one if nothing stored
  useEffect(() => {
    if (!activeRegId && defaultReg) {
      setActiveRegId(defaultReg);
    }
  }, [defaultReg, activeRegId]);

  const setReg = (id) => {
    setActiveRegId(id);
    localStorage.setItem("vgc_active_reg", id);
  };

  const activeReg = regs.find((r) => r.id === activeRegId) ?? regs.find((r) => r.active);

  return (
    <RegCtx.Provider value={{ regs, activeRegId: activeRegId ?? defaultReg, activeReg, setReg }}>
      {children}
    </RegCtx.Provider>
  );
}

export const useRegulation = () => useContext(RegCtx);
