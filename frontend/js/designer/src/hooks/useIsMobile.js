import { useState, useEffect } from 'react';

const MOBILE_BREAKPOINT = 768;
const MQL = typeof window !== 'undefined'
  ? window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
  : null;

/**
 * Reactive mobile breakpoint hook.
 *
 * Uses matchMedia for BOTH the initial state and change detection.
 * This avoids a Safari iOS timing issue where window.innerWidth briefly
 * reports the default layout viewport (980px) before the <meta viewport>
 * tag is applied — matchMedia respects the viewport meta from the start.
 */
export default function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => MQL ? MQL.matches : false);

  useEffect(() => {
    if (!MQL) return;

    // Sync in case the value changed between useState init and effect
    setIsMobile(MQL.matches);

    const handler = (e) => setIsMobile(e.matches);
    MQL.addEventListener('change', handler);
    return () => MQL.removeEventListener('change', handler);
  }, []);

  return isMobile;
}
