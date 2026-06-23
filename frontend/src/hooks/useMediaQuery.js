import { useEffect, useState } from 'react';

// Reactive CSS media-query matcher. Inline styles can't use @media, so this is
// the breakpoint primitive every responsive page reads from.
export function useMediaQuery(query) {
  const get = () =>
    typeof window !== 'undefined' && window.matchMedia(query).matches;

  const [matches, setMatches] = useState(get);

  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

export const MOBILE_QUERY = '(max-width: 768px)';
export const useIsMobile = () => useMediaQuery(MOBILE_QUERY);
