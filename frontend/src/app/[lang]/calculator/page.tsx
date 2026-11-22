'use client';
import { useEffect, useState } from 'react';
import HouseZones from '@/components/HouseZones';
import { Disclaimer, ErrorText, RequireAuth } from '@/components/Bits';
import { useLang, useT } from '@/components/Providers';
import { api, money } from '@/lib/api';

const ZONES = ['walls', 'floor', 'ceiling', 'roof'];

export default function Calculator() {
  return <RequireAuth role="client"><Calc /></RequireAuth>;
}

function Calc() {
  const t = useT();
  const lang = useLang();
  const [f, setF] = useState({ type: 'house', area: '120', floors: '2', rooms: '4', city: 'Tashkent' });
  const [obj, setObj] = useState<any>(null);
  const [zones, setZones] = useState<string[]>(ZONES);
  const [res, setRes] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState(false);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const next = { ...f };
    for (const k of ['type', 'area', 'floors', 'rooms', 'city'] as const) { const v = q.get(k); if (v) next[k] = v.slice(0, 80); }
    setF(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const toggle = (z: string) => setZones((cur) => (cur.includes(z) ? cur.filter((x) => x !== z) : [...cur, z]));
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });

  async function create() {
    setBusy(true); setErr(null);
    try { setObj(await api('/api/v1/objects', { body: f })); } catch (e: any) { setErr(e.error); }
    setBusy(false);
  }
  async function calc() {
    setBusy(true); setErr(null); setRes(null); setAdded(false);
    try { setRes(await api(`/api/v1/objects/${obj.id}/calculate`, { body: { zones } })); } catch (e: any) { setErr(e.error); }
    setBusy(false);
  }
  async function addAll() {
    setErr(null);
    try {
      for (const ln of res.lines) if (ln.best) await api('/api/v1/cart', { body: { offer_id: ln.best.offer_id, qty: ln.qty } });
      setAdded(true);
    } catch (e: any) { setErr(e.error); }
  }
  const lines = (z: string) => (res ? res.lines.filter((l: any) => l.zone === z) : []);
  const zoneSum = (z: string) => lines(z).reduce((a: number, l: any) => a + (l.best ? Number(l.best.line_total) : 0), 0);
  return (
    <>
      <h1>{t('calc.title')}</h1>
      <Disclaimer />
      <div className="calc2">
        <div>
          <div className="card">
            <h3>{t('calc.object')}</h3>
            <div className="row">
              <div><label htmlFor="ty">{t('calc.type')}</label>
                <select id="ty" value={f.type} onChange={set('type')} disabled={!!obj}>
                  {['apartment', 'house', 'complex'].map((x) => <option key={x} value={x}>{t(`type.${x}`)}</option>)}</select></div>
              <div><label htmlFor="ar">{t('calc.area')}</label><input id="ar" type="number" min="5" value={f.area} onChange={set('area')} disabled={!!obj} /></div>
              <div><label htmlFor="fl">{t('calc.floors')}</label><input id="fl" type="number" min="1" max="100" value={f.floors} onChange={set('floors')} disabled={!!obj} /></div>
              <div><label htmlFor="rm">{t('calc.rooms')}</label><input id="rm" type="number" min="0" value={f.rooms} onChange={set('rooms')} disabled={!!obj} /></div>
              <div><label htmlFor="ct">{t('calc.city')}</label><input id="ct" value={f.city} onChange={set('city')} disabled={!!obj} /></div>
            </div>
            {!obj ? <div className="actions"><button className="btn" disabled={busy} onClick={create}>{t('calc.next')}</button></div>
                  : <div className="actions"><button className="btn ghost" onClick={() => { setObj(null); setRes(null); }}>{t('calc.change')}</button></div>}
          </div>
          {obj && (
            <div className="card" style={{ marginTop: 16 }}>
              <h3>{t('calc.zones')}</h3>
              <div className="zonebox"><HouseZones active={zones} onToggle={toggle} />
                <p className="muted small" style={{ textAlign: 'center', margin: '6px 0 0' }}>{t('calc.zone_hint')}</p></div>
              <div className="tabs">
                {ZONES.map((z) => (
                  <label key={z} className="check"><input type="checkbox" checked={zones.includes(z)} onChange={() => toggle(z)} />{t(`zone.${z}`)}</label>
                ))}
              </div>
              <button className="btn block" disabled={busy || zones.length === 0} onClick={calc}>{busy ? t('calc.working') : res ? t('calc.recalc') : t('calc.calculate')}</button>
            </div>
          )}
          <ErrorText code={err} />
        </div>
        <aside className="card estimate">
          <h3>{t('calc.estimate')}</h3>
          {!res ? <p className="muted">{t('calc.estimate_empty')}</p> : (
            <>
              {res.large_object && <div className="notice">{t('calc.large')}</div>}
              <span className="muted small">{t('calc.total')} · {t('calc.approx')}</span>
              <div className="total">{money(res.total, lang)}</div>
              <h4>{t('calc.breakdown')}</h4>
              {ZONES.filter((z) => zones.includes(z) && lines(z).length).map((z) => (
                <div className="brk" key={z}><div><b>{t(`zone.${z}`)}</b>
                  <small>{lines(z).map((l: any) => l.category_names[lang]).join(', ')}</small></div><b>{money(zoneSum(z), lang)}</b></div>
              ))}
              <div className="brk"><span>{t('calc.goods')}</span><b>{money(res.goods_total, lang)}</b></div>
              <div className="brk"><span>{t('calc.delivery')}</span><b>{money(res.delivery_total, lang)}</b></div>
              <Disclaimer />
              <button className="btn block" onClick={addAll} disabled={added}>{added ? `✓ ${t('cart.added')}` : t('calc.add_all')}</button>
            </>
          )}
        </aside>
      </div>
      {res && ZONES.filter((z) => zones.includes(z) && lines(z).length).map((z) => (
        <div key={z} className="card" style={{ marginTop: 16 }}>
          <h3>{t(`zone.${z}`)}</h3>
          <div className="table-wrap"><table>
            <thead><tr><th>{t('calc.material')}</th><th>{t('calc.qty')}</th><th>{t('calc.offer')}</th><th>{t('calc.sum')}</th></tr></thead>
            <tbody>{lines(z).map((l: any, i: number) => (
              <tr key={i}>
                <td>{l.category_names[lang]}{l.note && <div className="muted small">{l.note}</div>}
                  {!l.norm_reviewed && <div className="tag">{t('calc.norm_ai')}</div>}</td>
                <td>{l.qty} {l.unit}</td>
                <td>{l.best ? <>{l.best.product}<div className="muted small">{l.best.seller} · {money(l.best.unit_price, lang)}
                  {l.best.unit_mismatch && <> · ⚠ {t('calc.unit_mismatch')}</>}</div></> : <span className="muted">{t('calc.no_offer')}</span>}</td>
                <td>{l.best ? money(l.best.line_total, lang) : '—'}</td>
              </tr>))}</tbody>
          </table></div>
        </div>
      ))}
    </>
  );
}
