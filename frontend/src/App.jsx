// src/App.jsx
import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, NavLink, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useIsMobile } from './hooks/useMediaQuery';
import { RegulationProvider, useRegulation } from './lib/RegulationContext';
import { ThemeProvider, useTheme, THEMES } from './lib/ThemeContext';
import { CalculatorProvider } from './lib/CalculatorContext';
import MoveLookup         from './pages/MoveLookup';
import MetaAnalysis       from './pages/MetaAnalysis';
import TeamBuilder        from './pages/TeamBuilder';
import Calculator         from './pages/Calculator';
import SpeedTier          from './pages/SpeedTier';
import AccuracyCheck      from './pages/AccuracyCheck';
import ItemDex            from './pages/ItemDex';
import MyNotes            from './pages/MyNotes';
import Draft              from './pages/Draft';
import Tournament         from './pages/Tournament';
import TournamentResults  from './pages/TournamentResults';
import TournamentTeams    from './pages/TournamentTeams';
import './index.css';
import logo from './images/logo-converted-from-png.svg';

const qc = new QueryClient({
  defaultOptions: { queries: { staleTime: 5 * 60_000, retry: 1 } },
});

const NAV = [
  { path: '/',                    label: 'Meta',              icon: '◉' },
  { path: '/moves',               label: 'Move lookup',       icon: '⌖' },
  { path: '/teams',               label: 'My teams',          icon: '◧' },
  { path: '/tools/notes',         label: 'My Notes',          icon: '📓' },
];

const TOOLS_NAV = [
  { path: '/tournament-teams', label: 'Tournament teams', icon: '◈' },
  { path: '/tools/calculator', label: 'Calculator', icon: '⊞' },
  { path: '/tools/speed-tier', label: 'Speed Tier',  icon: '⚡' },
  { path: '/tools/accuracy',   label: 'Accuracy',    icon: '◎' },
  { path: '/tools/items',      label: 'Item Dex',    icon: '🎒' },
];

const GAME_NAV = [
  { path: '/tools/draft', label: 'Game Room', icon: '⬡' },
  { path: '/tools/tournament', label: 'Tournament', icon: '🏆' },
  { path: '/tools/tournament-results', label: 'Results', icon: '🥇' },
];

const selectStyle = {
  background: 'var(--bg2)', border: '1px solid var(--border)',
  borderRadius: 8, color: 'var(--text-secondary)', fontSize: 12,
  padding: '6px 10px', fontFamily: 'var(--mono)',
  cursor: 'pointer', width: '100%', outline: 'none',
};

const labelStyle = {
  fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--text-muted)',
  letterSpacing: '.08em', marginBottom: 6,
};

function RegSwitcher() {
  const { regs, activeRegId, setReg } = useRegulation();
  if (!regs.length) return null;
  return (
    <select value={activeRegId ?? ''} onChange={e => setReg(e.target.value)} style={selectStyle}>
      {regs.map(r => (
        <option key={r.id} value={r.id}>{r.label}</option>
      ))}
    </select>
  );
}

function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();
  return (
    <select value={theme} onChange={e => setTheme(e.target.value)} style={selectStyle}>
      {THEMES.map(t => (
        <option key={t.id} value={t.id}>{t.label}</option>
      ))}
    </select>
  );
}

function NavItem({ path, label, icon, onNavigate }) {
  return (
    <NavLink
      to={path}
      end={path === '/'}
      onClick={onNavigate}
      style={({ isActive }) => ({
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '9px 12px', borderRadius: 8,
        textDecoration: 'none', fontSize: 13, fontWeight: 600,
        color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
        background: isActive ? 'var(--bg3)' : 'transparent',
        borderLeft: isActive ? '2px solid var(--accent)' : '2px solid transparent',
      })}
    >
      <span style={{ fontFamily: 'var(--mono)', fontSize: 16, opacity: .7 }}>{icon}</span>
      {label}
    </NavLink>
  );
}

function Sidebar({ mobile = false, onNavigate }) {
  return (
    <aside style={{
      width: 210, flexShrink: 0,
      background: 'var(--bg1)', borderRight: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column',
      padding: '24px 16px', gap: 4,
      ...(mobile ? {
        position: 'fixed', top: 0, left: 0, bottom: 0, zIndex: 50,
        overflowY: 'auto', boxShadow: '4px 0 24px rgba(0,0,0,.4)',
      } : {}),
    }}>
      <img
        src={logo}
        alt="VGCtool"
        style={{ height: 'auto', width: 'auto', display: 'block', marginBottom: 4 }}
      />

      {/* Nav */}
      {NAV.map(item => <NavItem key={item.path} {...item} onNavigate={onNavigate} />)}

      {/* Tools section */}
      <div style={{ ...labelStyle, marginTop: 16, marginBottom: 6 }}>TOOLS</div>
      {TOOLS_NAV.map(item => <NavItem key={item.path} {...item} onNavigate={onNavigate} />)}

      {/* Game section */}
      <div style={{ ...labelStyle, marginTop: 16, marginBottom: 6 }}>GAMES</div>
      {GAME_NAV.map(item => <NavItem key={item.path} {...item} onNavigate={onNavigate} />)}

      {/* Spacer */}
      <div style={{ flex: 1, minHeight: 16 }} />

      {/* Regulation switcher */}
      <div style={{ marginBottom: 12 }}>
        <div style={labelStyle}>REGULATION</div>
        <RegSwitcher />
      </div>

      {/* Theme switcher */}
      <div>
        <div style={labelStyle}>THEME</div>
        <ThemeSwitcher />
      </div>
    </aside>
  );
}

function MobileTopBar({ onMenu }) {
  return (
    <header style={{
      flexShrink: 0, height: 52,
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '0 14px',
      background: 'var(--bg1)', borderBottom: '1px solid var(--border)',
    }}>
      <button
        onClick={onMenu}
        aria-label="Open menu"
        style={{
          display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 4,
          width: 38, height: 38, padding: 0,
          background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8,
        }}
      >
        <span style={barStyle} /><span style={barStyle} /><span style={barStyle} />
      </button>
      <img src={logo} alt="VGCtool" style={{ height: 24, width: 'auto', display: 'block' }} />
    </header>
  );
}

const barStyle = {
  display: 'block', width: 16, height: 2, margin: '0 auto',
  background: 'var(--text-secondary)', borderRadius: 2,
};

function MobileLayout({ children }) {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => { setOpen(false); }, [pathname]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <MobileTopBar onMenu={() => setOpen(true)} />
      {open && (
        <>
          <div
            onClick={() => setOpen(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 40, background: 'rgba(0,0,0,.5)' }}
          />
          <Sidebar mobile onNavigate={() => setOpen(false)} />
        </>
      )}
      <main style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: '18px 16px', willChange: 'scroll-position' }}>
        {children}
        <Footer />
      </main>
    </div>
  );
}

function Footer() {
  return (
    <footer style={{
      marginTop: 32, paddingTop: 16, borderTop: '1px solid var(--border)',
      fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--text-muted)',
      textAlign: 'center',
    }}>
      Powered by Claude Code.
    </footer>
  );
}

function Layout({ children }) {
  const isMobile = useIsMobile();
  if (isMobile) return <MobileLayout>{children}</MobileLayout>;
  return (
    <div style={{ display: 'flex', height: '100vh' }}>
      <Sidebar />
      <main style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: '28px 32px', willChange: 'scroll-position' }}>
        {children}
        <Footer />
      </main>
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={qc}>
        <CalculatorProvider>
        <RegulationProvider>
          <BrowserRouter>
            <Layout>
              <Routes>
                <Route path="/"      element={<MetaAnalysis />} />
                <Route path="/moves" element={<MoveLookup />} />
                <Route path="/meta"  element={<MetaAnalysis />} />
                <Route path="/teams" element={<TeamBuilder />} />
                <Route path="/tournament-teams" element={<TournamentTeams />} />
                <Route path="/tools/calculator" element={<Calculator />} />
                <Route path="/tools/speed-tier" element={<SpeedTier />} />
                <Route path="/tools/accuracy"   element={<AccuracyCheck />} />
                <Route path="/tools/items"      element={<ItemDex />} />
                <Route path="/tools/notes"      element={<MyNotes />} />
                <Route path="/tools/draft"      element={<Draft />} />
                <Route path="/tools/tournament" element={<Tournament />} />
                <Route path="/tools/tournament-results" element={<TournamentResults />} />
              </Routes>
            </Layout>
          </BrowserRouter>
        </RegulationProvider>
        </CalculatorProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
