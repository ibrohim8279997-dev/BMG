/** Full / lite site version. 'auto' decides per visit from the device and the network; the visitor can override it. */
export type ModePref = 'auto' | 'full' | 'lite';
export type Mode = 'full' | 'lite';

/** Same rules as the inline script in layout.tsx (which runs before first paint so there is no flash). */
export function detectMode(): Mode {
  try {
    const nav: any = navigator;
    const c = nav.connection || {};
    const slow = c.saveData || /(^|-)2g$|3g/.test(c.effectiveType || '');
    const weak = (nav.deviceMemory && nav.deviceMemory <= 2) || (nav.hardwareConcurrency && nav.hardwareConcurrency <= 2);
    const calm = matchMedia('(prefers-reduced-motion: reduce)').matches || matchMedia('(prefers-reduced-data: reduce)').matches;
    return slow || weak || calm ? 'lite' : 'full';
  } catch { return 'full'; }
}

export function readPref(): ModePref {
  try { const v = localStorage.getItem('mode'); return v === 'full' || v === 'lite' ? v : 'auto'; } catch { return 'auto'; }
}

export const resolveMode = (p: ModePref): Mode => (p === 'auto' ? detectMode() : p);
