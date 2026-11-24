'use client';
import { useT } from './Providers';

/** Two-and-a-half-D house. Each of the four zones is one SVG group; selected zones light up in the accent colour.
 *  Pass onToggle to make the zones clickable (keyboard: Enter / Space). */
export default function HouseZones({ active, onToggle }: { active: string[]; onToggle?: (z: string) => void }) {
  const t = useT();
  const zone = (z: string) => ({
    className: `hz ${active.includes(z) ? 'on' : ''} ${onToggle ? 'click' : ''}`,
    onClick: onToggle ? () => onToggle(z) : undefined,
    onKeyDown: onToggle ? (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(z); } } : undefined,
    role: onToggle ? 'checkbox' : undefined, 'aria-checked': onToggle ? active.includes(z) : undefined,
    tabIndex: onToggle ? 0 : undefined, 'aria-label': t(`zone.${z}`),
  });
  const tile = (f: number) => {
    // roof-plane hatch: joins the front slope edge to the back edge
    const x1 = 170 + 110 * f, y1 = 36 + 76 * f, x2 = 232 + 112 * f, y2 = 22 + 74 * f;
    return <line key={f} className="ln" x1={x1} y1={y1} x2={x2} y2={y2} />;
  };
  return (
    <svg className="house" viewBox="0 0 400 262" role="img" aria-label={t('calc.house_alt')}>
      <defs>
        <linearGradient id="glass" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#e4eaea" /><stop offset="1" stopColor="#93a6a9" />
        </linearGradient>
      </defs>
      <ellipse cx="200" cy="244" rx="190" ry="11" className="ground" />
      <ellipse cx="206" cy="238" rx="178" ry="9" className="lawn" />
      {/* tree */}
      <rect x="32" y="190" width="8" height="46" rx="3" className="trunk" />
      <circle cx="36" cy="180" r="24" className="tree2" /><circle cx="26" cy="190" r="16" className="tree1" /><circle cx="48" cy="188" r="17" className="tree1" />

      <g {...zone('floor')}>
        <rect className="a" x="62" y="214" width="212" height="15" rx="2" />
        <polygon className="b" points="274,214 334,200 334,214 274,229" />
        <rect className="c" x="204" y="229" width="56" height="8" rx="1" />
        <title>{t('zone.floor')}</title>
      </g>

      <g {...zone('walls')}>
        <rect className="a" x="70" y="110" width="204" height="104" />
        <polygon className="b" points="274,110 332,96 332,200 274,214" />
        <rect className="win" x="92" y="134" width="40" height="48" rx="2" /><line className="ln" x1="112" y1="134" x2="112" y2="182" /><line className="ln" x1="92" y1="158" x2="132" y2="158" />
        <rect className="win" x="150" y="134" width="40" height="48" rx="2" /><line className="ln" x1="170" y1="134" x2="170" y2="182" /><line className="ln" x1="150" y1="158" x2="190" y2="158" />
        <rect className="door" x="212" y="152" width="40" height="62" rx="2" /><circle cx="243" cy="184" r="2.4" fill="#e8eef8" />
        <polygon className="win" points="290,126 316,120 316,160 290,166" /><line className="ln" x1="303" y1="123" x2="303" y2="163" />
        <title>{t('zone.walls')}</title>
      </g>

      <g {...zone('ceiling')}>
        <rect className="c" x="70" y="110" width="204" height="10" />
        <polygon className="c" points="274,110 332,96 332,106 274,120" />
        <title>{t('zone.ceiling')}</title>
      </g>

      <g {...zone('roof')}>
        <rect className="c" x="246" y="18" width="17" height="40" />
        <polygon className="b" points="170,36 232,22 346,96 280,112" />
        {[.25, .5, .75].map(tile)}
        <polygon className="a" points="58,112 170,36 282,112" />
        <line className="ln" x1="83" y1="96" x2="257" y2="96" /><line className="ln" x1="106" y1="80" x2="234" y2="80" /><line className="ln" x1="129" y1="64" x2="211" y2="64" />
        <circle className="win" cx="170" cy="84" r="11" />
        <title>{t('zone.roof')}</title>
      </g>
    </svg>
  );
}
