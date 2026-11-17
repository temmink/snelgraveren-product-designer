import { useState, useEffect } from 'react';

const MOBILE_BREAKPOINT = 768;

/**
 * Reactive mobile breakpoint hook.
 *
 * Checks multiple signals to reliably detect mobile on all browsers:
 * 1. matchMedia (created inside useEffect, not at module level — Safari iOS
 *    can misreport matchMedia when evaluated before DOM is ready)
 * 2. screen.width as fallback (always reports device CSS pixels,
 *    unaffected by viewport meta tag timing)
 */
export default function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') return false;
    // Use screen.width as initial value — it's stable and unaffected by
    // viewport meta timing issues that plague window.innerWidth on Safari iOS
    return window.screen.width < MOBILE_BREAKPOINT;
  });

  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);

    // Sync with matchMedia (now that DOM is ready, this should be accurate)
    setIsMobile(mql.matches || window.screen.width < MOBILE_BREAKPOINT);

    const handler = (e) => setIsMobile(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  return isMobile;
}
