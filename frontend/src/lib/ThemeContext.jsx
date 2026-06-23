// src/lib/ThemeContext.jsx
import { createContext, useContext, useState, useLayoutEffect } from 'react';

export const THEMES = [
  { id: 'dark',         label: '◑  Dark' },
  { id: 'light',        label: '○  Light' },
  { id: 'championship', label: '◉  Championship' },
];

const ThemeContext = createContext({ theme: 'dark', setTheme: () => {} });

export function ThemeProvider({ children }) {
  const [theme, setThemeRaw] = useState(
    () => localStorage.getItem('vgc-theme') ?? 'championship'
  );

  const setTheme = (id) => {
    setThemeRaw(id);
    localStorage.setItem('vgc-theme', id);
  };

  // useLayoutEffect runs synchronously before paint — no theme flash
  useLayoutEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
