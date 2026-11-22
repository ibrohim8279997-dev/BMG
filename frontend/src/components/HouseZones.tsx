'use client';
import { useT } from './Providers';

/** Lightweight 2D house (no 3D in MVP). Clicking a part toggles that zone; selected zones are highlighted. */
export default function HouseZones({ active, onToggle }: { active: string[]; onToggle?: (z: string) => void }) {
  const t = useT();
  const zone = (z: string) => ({
    className: `hz ${active.includes(z) ? 'on' : ''} ${onToggle ? 'click' : ''}`,
    onClick: onToggle ? () => onToggle(z) : undefined,
    onKeyDown: onToggle ? (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(z); } } : undefined,
    role: onToggle ? 'checkbox' : undefined, 'aria-checked': onToggle ? active.includes(z) : undefined,
    tabIndex: onToggle ? 0 : undefined, 'aria-label': t(`zone.${z}`),
  });
  return (
    <svg className="house" viewBox="0 0 340 230" role="img" aria-label={t('calc.house_alt')}>
      <ellipse cx="170" cy="214" rx="150" ry="9" className="hz-shadow" />
      <g {...zone('floor')}><rect x="36" y="188" width="268" height="18" rx="3" /><title>{t('zone.floor')}</title></g>
      <g {...zone('walls')}>
        <rect x="56" y="104" width="228" height="84" />
        <rect x="82" y="124" width="34" height="42" className="win" /><rect x="152" y="124" width="34" height="42" className="win" />
        <rect x="222" y="124" width="34" height="64" className="win" /><title>{t('zone.walls')}</title>
      </g>
      <g {...zone('ceiling')}><rect x="56" y="104" width="228" height="12" className="dash" /><title>{t('zone.ceiling')}</title></g>
      <g {...zone('roof')}><polygon points="36,106 170,28 304,106" /><title>{t('zone.roof')}</title></g>
    </svg>
  );
}
