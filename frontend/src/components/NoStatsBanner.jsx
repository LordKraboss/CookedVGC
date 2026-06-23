// components/NoStatsBanner.jsx
// Shown on stats-driven pages when the active regulation has no usage data yet
// (e.g. a brand-new reg Showdown hasn't published numbers for). The features
// still work off the global Showdown dex, just with everything at 0% usage.
export default function NoStatsBanner({ children }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 10,
      padding: '12px 14px', marginBottom: 16, borderRadius: 10,
      background: 'var(--accent-dim)', border: '1px solid var(--accent)',
      fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5,
    }}>
      <span style={{ flexShrink: 0 }}>ℹ️</span>
      <span>
        {children ?? (
          <>
            No usage stats for this regulation yet — Showdown hasn't published data for it.
            Everything works off the full roster at{' '}
            <strong style={{ color: 'var(--text-primary)' }}>0% usage</strong> until stats are available.
          </>
        )}
      </span>
    </div>
  );
}
