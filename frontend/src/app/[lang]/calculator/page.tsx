'use client';
import { useState } from 'react';
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
  return (
    <>
      <h1>{t('calc.title')}</h1>
      <Disclaimer />
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
          <div className="tabs">
            {ZONES.map((z) => (
              <label key={z} className="check"><input type="checkbox" checked={zones.includes(z)}
                onChange={(e) => setZones(e.target.checked ? [...zones, z] : zones.filter((x) => x !== z))} />{t(`zone.${z}`)}</label>
            ))}
          </div>
          <button className="btn" disabled={busy || zones.length === 0} onClick={calc}>{busy ? t('calc.working') : t('calc.calculate')}</button>
        </div>
      )}
      <ErrorText code={err} />
      {res && (
        <>
          {res.large_object && <div className="notice">{t('calc.large')}</div>}
          <Disclaimer />
          {ZONES.filter((z) => zones.includes(z)).map((z) => {
            const lines = res.lines.filter((l: any) => l.zone === z);
            if (!lines.length) return null;
            return (
              <div key={z} className="card" style={{ marginTop: 16 }}>
                <h3>{t(`zone.${z}`)}</h3>
                <div className="table-wrap"><table>
                  <thead><tr><th>{t('calc.material')}</th><th>{t('calc.qty')}</th><th>{t('calc.offer')}</th><th>{t('calc.sum')}</th></tr></thead>
                  <tbody>{lines.map((l: any, i: number) => (
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
            );
          })}
          <div className="card" style={{ marginTop: 16 }}>
            <div className="split">
              <div><span className="muted">{t('calc.goods')}</span><div className="price">{money(res.goods_total, lang)}</div></div>
              <div><span className="muted">{t('calc.delivery')}</span><div className="price">{money(res.delivery_total, lang)}</div></div>
            </div>
            <p className="price">{t('calc.total')}: {money(res.total, lang)}</p>
            <button className="btn" onClick={addAll} disabled={added}>{added ? `✓ ${t('cart.added')}` : t('calc.add_all')}</button>
          </div>
        </>
      )}
    </>
  );
}
