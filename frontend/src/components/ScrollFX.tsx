'use client';
import { useEffect, useRef } from 'react';
import { useMode } from './Providers';

/** One passive scroll listener (rAF-throttled): header state, reading-progress bar and gentle parallax on [data-parallax].
 *  Parallax and progress are skipped in the lite version and when the visitor asks for reduced motion. */
export default function ScrollFX() {
  const { mode } = useMode();
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = document.documentElement;
    const calm = mode === 'lite' || matchMedia('(prefers-reduced-motion: reduce)').matches;
    let raf = 0;
    const run = () => {
      raf = 0;
      const y = window.scrollY;
      if (y > 24) root.dataset.scrolled = '1'; else delete root.dataset.scrolled;
      if (calm) return;
      const max = root.scrollHeight - innerHeight;
      if (bar.current) bar.current.style.transform = `scaleX(${max > 0 ? Math.min(1, y / max) : 0})`;
      document.querySelectorAll<HTMLElement>('[data-parallax]').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.bottom < 0 || r.top > innerHeight) return;
        const k = Number(el.dataset.parallax) || 0.08;
        el.style.setProperty('--py', `${Math.round((r.top + r.height / 2 - innerHeight / 2) * -k)}px`);
      });
    };
    const on = () => { if (!raf) raf = requestAnimationFrame(run); };
    run();
    addEventListener('scroll', on, { passive: true });
    addEventListener('resize', on);
    return () => { removeEventListener('scroll', on); removeEventListener('resize', on); if (raf) cancelAnimationFrame(raf); };
  }, [mode]);
  return <div ref={bar} className="scroll-progress" aria-hidden="true" />;
}
