import { catImg } from '@/lib/images';

/** Product photo (found by AI during import), else the category photo, else a drawn icon (paint, drywall). */
export default function ProductImage({ cat, src: own, big = false, first = false }: { cat?: string | null; src?: string | null; big?: boolean; first?: boolean }) {
  const src = (own && own.startsWith('/api/v1/products/') ? own : null) || catImg(cat);
  return (
    <div className={`pimg ${big ? 'big' : ''}`}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" width={400} height={300} {...(first ? { fetchPriority: 'high' as const } : { loading: 'lazy' as const })} />
      ) : cat === 'paint' ? (
        <svg className="ph" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 22h40l-4 32a4 4 0 0 1-4 3H20a4 4 0 0 1-4-3z" /><ellipse cx="32" cy="22" rx="20" ry="5" /><path d="M20 10c4-4 20-4 24 0M32 5v6" /><path d="M18 36h28" opacity=".5" />
        </svg>
      ) : (
        <svg className="ph" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="8" y="14" width="48" height="36" rx="3" /><path d="M8 26h48M8 38h48M24 14v12M40 26v12M24 38v12" opacity=".6" />
        </svg>
      )}
    </div>
  );
}
