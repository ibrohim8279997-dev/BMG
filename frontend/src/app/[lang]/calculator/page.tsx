'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import HouseConfigurator, { FLOORS } from '@/components/HouseConfigurator';
import ProjectDescribe from '@/components/ProjectDescribe';
import { CountUp, Disclaimer, ErrorText, notifyCart } from '@/components/Bits';
import Icon from '@/components/Icon';
import { useAuth, useLang, useT } from '@/components/Providers';
import { api, money } from '@/lib/api';
import { clearPending, loginUrl, peekPending, savePending } from '@/lib/pending';
import { clamp, DEFAULT_DESIGN, Design, designFromArea, geometryPayload, loadDesign, saveDesign } from '@/lib/house/design';

const ZONES = ['walls', 'floor', 'ceiling', 'roof'];

/** Open to guests: the estimate is computed by the stateless preview endpoint. Login is asked only at "add to cart". */
export default function Calc() {
  const t = useT();
  const lang = useLang();
  const router = useRouter();
  const { me, loading } = useAuth();
  const isClient = me?.role === 'client';
  const [f, setF] = useState({ type: 'house', rooms: '4', city: 'Tashkent' });
  const [design, setDesign] = useState<Design>(DEFAULT_DESIGN);
  const [sig, setSig] = useState('');            // parameters the saved object was created with
  const [obj, setObj] = useState<any>(null);     // set = parameters are locked in (saved object for clients, {} for guests)
  const [resumed, setResumed] = useState(false);
  const [zones, setZones] = useState<string[]>(ZONES);
  const [res, setRes] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState(false);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const next = { ...f };
    for (const k of ['type', 'rooms', 'city'] as const) { const v = q.get(k); if (v) next[k] = v.slice(0, 80); }
    setF(next);
    const saved = loadDesign() || DEFAULT_DESIGN, area = Number(q.get('area'));
    setDesign(area > 0 ? designFromArea(area, Number(q.get('floors')) || 1, saved) : saved);
    const p = peekPending();   // back from login with a parked estimate: restore everything the guest had entered
    if (p?.kind === 'calc') {
      setF({ type: p.form.type, rooms: p.form.rooms, city: p.form.city }); if (p.design) setDesign(p.design);
      setZones(p.zones); setRes(p.res); setObj({}); setResumed(q.get('resume') === '1');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (resumed && !loading && me) { setResumed(false); if (isClient) addAll(); clearPending(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumed, loading, me]);
  useEffect(() => { saveDesign(design); }, [design]);
  useEffect(() => {   // keep the floor count inside what the chosen object type allows
    const [a, b] = FLOORS[f.type] || FLOORS.house;
    if (design.floors < a || design.floors > b) setDesign((d) => ({ ...d, floors: clamp(d.floors, a, b) }));
  }, [f.type, design.floors]);
  const geo = geometryPayload(design, f.type);
  const payload = { ...f, ...geo, area: (design.length * design.width * geo.floors).toFixed(2) };   // the server recomputes the area from the dimensions
  const curSig = JSON.stringify(payload);
  const toggle = (z: string) => setZones((cur) => (cur.includes(z) ? cur.filter((x) => x !== z) : [...cur, z]));
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });

  async function create() {
    setBusy(true); setErr(null);
    try { setObj(isClient ? await api('/api/v1/objects', { body: payload }) : {}); setSig(curSig); } catch (e: any) { setErr(e.error); }
    setBusy(false);
  }
  async function calc() {
    setBusy(true); setErr(null); setRes(null); setAdded(false);
    try {
      let o = obj;
      if (o.id && sig !== curSig) { o = await api('/api/v1/objects', { body: payload }); setObj(o); setSig(curSig); }   // dimensions changed in 3D: save the new version
      setRes(await (o.id ? api(`/api/v1/objects/${o.id}/calculate`, { body: { zones } }) : api('/api/v1/calculate/preview', { body: { ...payload, zones } })));
    } catch (e: any) { setErr(e.error); }
    setBusy(false);
  }
  async function addAll() {
    if (!me) {   // guest: park the estimate, log in, come back and add it
      savePending({ kind: 'calc', form: f, design, zones, res });
      return router.push(loginUrl(lang, `/${lang}/calculator?resume=1`));
    }
    setErr(null);
    try {
      for (const ln of res.lines) if (ln.best) await api('/api/v1/cart', { body: { offer_id: ln.best.offer_id, qty: ln.qty } });
      setAdded(true); notifyCart();
    } catch (e: any) { setErr(e.error); }
  }
  const lines = (z: string) => (res ? res.lines.filter((l: any) => l.zone === z) : []);
  const zoneSum = (z: string) => lines(z).reduce((a: number, l: any) => a + (l.best ? Number(l.best.line_total) : 0), 0);
  return (
    <>
      <h1>{t('calc.title')}</h1>
      <Disclaimer />
      <HouseConfigurator design={design} onChange={setDesign} type={f.type} zones={zones} onZone={toggle} />
      <div className="calc2">
        <div>
          {!obj && isClient && <ProjectDescribe onApply={(fl, zs) => {
            setF((cur) => ({ ...cur, ...(fl.type ? { type: fl.type } : {}), ...(fl.rooms !== null ? { rooms: String(fl.rooms) } : {}), ...(fl.city ? { city: fl.city } : {}) }));
            if (fl.area !== null) setDesign((d) => designFromArea(fl.area!, fl.floors ?? d.floors, d));
            else if (fl.floors !== null) setDesign((d) => ({ ...d, floors: fl.floors! }));
            if (zs.length) setZones(zs);
          }} />}
          <div className="card">
            <h2 className="sub">{t('calc.object')}</h2>
            <div className="row">
              <div><label htmlFor="ty">{t('calc.type')}</label>
                <select id="ty" value={f.type} onChange={set('type')} disabled={!!obj}>
                  {['apartment', 'house', 'complex'].map((x) => <option key={x} value={x}>{t(`type.${x}`)}</option>)}</select></div>
              <div><label htmlFor="rm">{t('calc.rooms')}</label><input id="rm" type="number" min="0" value={f.rooms} onChange={set('rooms')} disabled={!!obj} /></div>
              <div><label htmlFor="ct">{t('calc.city')}</label><input id="ct" value={f.city} onChange={set('city')} disabled={!!obj} /></div>
            </div>
            <p className="calc-area"><span className="muted small">{t('calc.area')}</span> <b className="num">{payload.area}</b>
              <span className="muted small"> = {design.length} × {design.width}{geo.floors > 1 ? ` × ${geo.floors}` : ''} · {t('studio.from_3d')}</span></p>
            {!obj ? <div className="actions"><button className="btn" disabled={busy} onClick={create}>{t('calc.next')}</button></div>
                  : <div className="actions"><button className="btn ghost" onClick={() => { setObj(null); setRes(null); }}>{t('calc.change')}</button></div>}
          </div>
          {obj && (
            <div className="card" style={{ marginTop: 16 }}>
              <h2 className="sub">{t('calc.zones')}</h2>
              <p className="muted small" style={{ margin: '0 0 6px' }}>{t('calc.zone_hint')}</p>
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
          <h2 className="sub">{t('calc.estimate')}</h2>
          {!res ? <div className="empty"><Icon name="calc" size={20} /><p style={{ margin: 0 }}>{t('calc.estimate_empty')}</p></div> : (
            <>
              {res.large_object && <div className="notice">{t('calc.large')}</div>}
              <span className="muted small">{t('calc.total')} · {t('calc.approx')}</span>
              <div className="total"><CountUp value={Number(res.total)} format={(n) => money(n, lang)} /></div>
              <h4>{t('calc.breakdown')}</h4>
              {ZONES.filter((z) => zones.includes(z) && lines(z).length).map((z, i) => (
                <div className="brk stg" style={{ ["--i" as any]: i }} key={z}><div><b>{t(`zone.${z}`)}</b>
                  <small>{lines(z).map((l: any) => l.category_names[lang]).join(', ')}</small></div><b>{money(zoneSum(z), lang)}</b></div>
              ))}
              <div className="brk"><span>{t('calc.goods')}</span><b>{money(res.goods_total, lang)}</b></div>
              <div className="brk"><span>{t('calc.delivery')}</span><b>{money(res.delivery_total, lang)}</b></div>
              <Disclaimer />
              <button className="btn block" onClick={addAll} disabled={added}>{added ? <><Icon name="check" /> {t('cart.added')}</> : <><Icon name="cart" /> {t('calc.add_all')}</>}</button>
            </>
          )}
        </aside>
      </div>
      {res && ZONES.filter((z) => zones.includes(z) && lines(z).length).map((z) => (
        <div key={z} className="card" style={{ marginTop: 16 }}>
          <h2 className="sub">{t(`zone.${z}`)}</h2>
          <div className="table-wrap"><table>
            <thead><tr><th>{t('calc.material')}</th><th>{t('calc.qty')}</th><th>{t('calc.offer')}</th><th>{t('calc.sum')}</th></tr></thead>
            <tbody>{lines(z).map((l: any, i: number) => (
              <tr key={i} className="stg" style={{ ['--i' as any]: i }}>
                <td>{l.category_names[lang]}{l.note && <div className="muted small">{l.note}</div>}
                  {!l.norm_reviewed && <div className="tag">{t('calc.norm_ai')}</div>}</td>
                <td>{l.qty} {l.unit}</td>
                <td>{l.best ? <>{l.best.product}<div className="muted small">{l.best.seller} · {money(l.best.unit_price, lang)}
                  {l.best.unit_mismatch && <> · <Icon name="warn" size={13} /> {t('calc.unit_mismatch')}</>}</div></> : <span className="muted">{t('calc.no_offer')}</span>}</td>
                <td>{l.best ? money(l.best.line_total, lang) : '—'}</td>
              </tr>))}</tbody>
          </table></div>
        </div>
      ))}
    </>
  );
}
