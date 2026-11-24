/** One icon set, one style: 24px grid, 2px round stroke, currentColor. Replaces emoji so icons follow theme and contrast. */
const P: Record<string, string> = {
  cart: 'M3 4h2.2l2 11h10.2l2-8H6.4 M9 20a1 1 0 100-.01 M17 20a1 1 0 100-.01',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  warn: 'M12 4l9 16H3z M12 10v4 M12 17.2v.01',
  arrow: 'M5 12h14 M13 6l6 6-6 6',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z M9 12l2 2 4-4',
  truck: 'M3 7h11v9H3z M14 10h4l3 3v3h-7 M7 19a1.6 1.6 0 100-.01 M17 19a1.6 1.6 0 100-.01',
  card: 'M3 6h18v12H3z M3 10h18 M7 15h3',
  star: 'M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.9 6.8 19.7l1-5.9L3.5 9.7l5.9-.8z',
  home: 'M4 11l8-7 8 7 M6 10v10h12V10',
  close: 'M6 6l12 12M18 6L6 18',
  calc: 'M6 3h12v18H6z M9 7h6 M9 12h.01 M12 12h.01 M15 12h.01 M9 16h.01 M12 16h.01 M15 16h.01',
};
export default function Icon({ name, size = 18, className }: { name: keyof typeof P | string; size?: number; className?: string }) {
  return (
    <svg className={`ico ${className || ''}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={P[name]} />
    </svg>
  );
}
