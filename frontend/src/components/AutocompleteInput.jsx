import { useState, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';

export function AutocompleteInput({
  value,
  onChange,
  onSelect,
  onKeyDown: externalKeyDown,
  placeholder,
  fetchSuggestions,
  queryKey,
  style,
  minChars = 3,
}) {
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const wrapperRef = useRef(null);

  const { data: suggestions = [] } = useQuery({
    queryKey: ['ac', queryKey, value],
    queryFn: () => fetchSuggestions(value),
    enabled: focused && value.length >= minChars,
    staleTime: 60_000,
    placeholderData: [],
  });

  useEffect(() => {
    setActiveIndex(-1);
    // only open when the user is actively in the field
    setOpen(focused && value.length >= minChars && suggestions.length > 0);
  }, [suggestions, value, focused]);

  useEffect(() => {
    const handler = (e) => {
      if (!wrapperRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const select = (name) => {
    onChange(name);
    onSelect(name);
    setOpen(false);
  };

  const handleKeyDown = (e) => {
    if (open) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex(i => Math.min(i + 1, suggestions.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex(i => Math.max(i - 1, -1));
        return;
      }
      if (e.key === 'Enter' && activeIndex >= 0) {
        e.preventDefault();
        select(suggestions[activeIndex]);
        return;
      }
      if (e.key === 'Escape') {
        setOpen(false);
        return;
      }
    }
    externalKeyDown?.(e);
  };

  return (
    <div ref={wrapperRef} style={{ position: 'relative', flex: 1, ...style }}>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => { setFocused(true); value.length >= minChars && suggestions.length > 0 && setOpen(true); }}
        onBlur={() => setFocused(false)}
        placeholder={placeholder}
        style={{ width: '100%' }}
      />
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 200,
          background: 'var(--bg1)', border: '1px solid var(--border)',
          borderRadius: 8, overflow: 'hidden',
          boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
        }}>
          {suggestions.map((name, i) => (
            <div
              key={name}
              onMouseDown={() => select(name)}
              onMouseEnter={() => setActiveIndex(i)}
              onMouseLeave={() => setActiveIndex(-1)}
              style={{
                padding: '9px 14px', fontSize: 13, cursor: 'pointer',
                background: i === activeIndex ? 'var(--accent-dim)' : 'transparent',
                color: i === activeIndex ? 'var(--accent)' : 'var(--text-primary)',
                borderBottom: i < suggestions.length - 1 ? '1px solid var(--border)' : 'none',
              }}
            >
              {name}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
