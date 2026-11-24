/** Read-only star rating (0-5, halves rounded). Decorative glyphs; the number is the accessible label. */
export default function Stars({ value, size = 16 }: { value: number | string; size?: number }) {
  const v = Math.max(0, Math.min(5, Math.round(Number(value) || 0)));
  return (
    <span className="stars" role="img" aria-label={`${Number(value).toFixed(1)} / 5`} style={{ fontSize: size }}>
      {'★'.repeat(v)}<span className="off">{'★'.repeat(5 - v)}</span>
    </span>
  );
}
