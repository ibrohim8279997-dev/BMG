'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useLang, useT } from './Providers';

export default function HeroCalc() {
  const t = useT();
  const lang = useLang();
  const router = useRouter();
  const [f, setF] = useState({ type: 'house', area: '120', floors: '2' });
  return (
    <form className="card hero-calc" onSubmit={(e) => { e.preventDefault(); router.push(`/${lang}/calculator?${new URLSearchParams(f)}`); }}>
      <h2 style={{ marginTop: 0 }}>{t('hero.calc_title')}</h2>
      <div className="row">
        <div><label htmlFor="hty">{t('calc.type')}</label>
          <select id="hty" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
            {['apartment', 'house', 'complex'].map((x) => <option key={x} value={x}>{t(`type.${x}`)}</option>)}</select></div>
        <div><label htmlFor="har">{t('calc.area')}</label>
          <input id="har" type="number" min="5" value={f.area} onChange={(e) => setF({ ...f, area: e.target.value })} /></div>
        <div><label htmlFor="hfl">{t('calc.floors')}</label>
          <input id="hfl" type="number" min="1" max="100" value={f.floors} onChange={(e) => setF({ ...f, floors: e.target.value })} /></div>
      </div>
      <button className="btn block" style={{ marginTop: 14 }}>{t('hero.go')}</button>
      <p className="muted small" style={{ margin: '10px 0 0' }}>✓ {t('hero.note')}</p>
    </form>
  );
}
