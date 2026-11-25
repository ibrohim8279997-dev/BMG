'use client';
import { useEffect, useRef, useState } from 'react';
import { ErrorText } from '@/components/Bits';
import { useT } from '@/components/Providers';
import { api } from '@/lib/api';

const FIELDS = ['name', 'price', 'stock', 'category', 'unit', 'cost_price'];
type Seller = { id: number; company_name: string };

/** Excel import of a seller's goods. AI finds the header row and the columns (and, for staff, the seller);
 * whatever it could not determine is asked here. After import AI looks for a photo of each product
 * and lists the ones it could not find. `base` is the seller-cabinet or the staff API. */
export default function ImportWizard({ base, sellers }: { base: string; sellers?: Seller[] }) {
  const t = useT();
  const [imp, setImp] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [searching, setSearching] = useState(false);
  const stop = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const admin = !!sellers;

  useEffect(() => () => { stop.current = true; }, []);

  async function upload(file: File) {
    setErr(null); setBusy(true);
    const fd = new FormData(); fd.append('file', file);
    try { setImp(await api(base, { form: fd })); } catch (e: any) { setErr(e.error); }
    setBusy(false);
    if (fileRef.current) fileRef.current.value = '';
  }
  async function patch(body: object) {
    setErr(null);
    try { setImp({ ...imp, ...(await api(`${base}/${imp.id}`, { method: 'PATCH', body })) }); } catch (e: any) { setErr(e.error); }
  }
  function setCol(field: string, v: string) {
    const mapping = { ...imp.mapping };
    if (v === '') delete mapping[field]; else mapping[field] = Number(v);
    patch({ mapping });
  }
  async function findImages(id: number) {
    stop.current = false; setSearching(true);
    try {
      for (let i = 0; i < 400 && !stop.current; i++) {
        const r = await api(`${base}/${id}/images`, { method: 'POST', body: {} });
        setImp((cur: any) => ({ ...cur, ...r }));
        if (r.result?.images?.done) break;
      }
    } catch (e: any) { setErr(e.error); }
    setSearching(false);
  }
  async function confirm() {
    setErr(null); setBusy(true);
    try {
      const r = await api(`${base}/${imp.id}/confirm`, { method: 'POST', body: {} });
      setImp({ ...imp, ...r });
      if (r.image_total > 0) findImages(r.id);
    } catch (e: any) { setErr(e.error); }
    setBusy(false);
  }

  if (imp?.status === 'confirmed') {
    const r = imp.result;
    const img = r.images || { found: [], not_found: [], done: false };
    const checked = img.found.length + img.not_found.length;
    return (
      <div className="card">
        <h3>{t('import.done')}{imp.seller && admin ? ` · ${imp.seller.company_name}` : ''}</h3>
        <p>{t('import.created')}: {r.created} · {t('import.updated')}: {r.updated} · {t('import.errors')}: {r.error_count}</p>
        {r.errors.length > 0 && <div className="table-wrap"><table><tbody>{r.errors.map((e: any, i: number) =>
          <tr key={i}><td>#{e.row}</td><td className="error">{t(`import.err.${e.error}`)}</td></tr>)}</tbody></table></div>}
        {imp.image_total > 0 && (
          <div style={{ marginTop: 16 }}>
            <h3>{t('import.images')}</h3>
            <p className="muted small">{t('import.images_hint')}</p>
            <p aria-live="polite">{t('import.images_progress', { done: checked, total: imp.image_total })}
              {' · '}<span className="ok">{t('import.images_found')}: {img.found.length}</span>
              {' · '}<span className="error">{t('import.images_not_found')}: {img.not_found.length}</span></p>
            {searching && <button className="btn ghost small" onClick={() => { stop.current = true; }}>{t('import.images_stop')}</button>}
            {!searching && !img.done && <button className="btn small" onClick={() => findImages(imp.id)}>{t('import.images_continue')}</button>}
            {img.done && <p className="ok">{t('import.images_done')}</p>}
            {img.not_found.length > 0 && (
              <details open={img.done} style={{ marginTop: 8 }}>
                <summary>{t('import.images_missing_list')}</summary>
                <ul>{img.not_found.map((x: any) => <li key={x.id}>{x.name} — <span className="error">{t('import.images_not_found_one')}</span></li>)}</ul>
              </details>)}
          </div>)}
        <button className="btn" style={{ marginTop: 12 }} disabled={searching} onClick={() => setImp(null)}>{t('import.another')}</button>
      </div>
    );
  }

  const unresolved: string[] = imp?.unresolved || [];
  return (
    <div className="card">
      <p className="muted">{t(admin ? 'import.admin_hint' : 'import.hint')}</p>
      <p className="muted small">{t('import.ai_hint')}</p>
      <input ref={fileRef} id="imp-file" type="file" accept=".xlsx" hidden disabled={busy}
        onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
      <button className="btn" disabled={busy} onClick={() => fileRef.current?.click()}>
        {busy ? t('import.analyzing') : t(admin ? 'import.upload_seller' : 'import.upload')}</button>
      <ErrorText code={err} />
      {imp && (
        <>
          {admin && (
            <div style={{ marginTop: 16 }}>
              <h3>{t('import.seller')}</h3>
              {imp.seller
                ? <p><b>{imp.seller.company_name}</b> <span className="tag ok">{t(`import.seller_by.${imp.seller_by || 'staff'}`)}</span></p>
                : <p className="error" role="alert">{t('import.seller_unknown')}</p>}
              <label htmlFor="imp-seller">{t('import.seller_choose')}</label>
              <select id="imp-seller" value={imp.seller?.id ?? ''} onChange={(e) => e.target.value && patch({ seller_id: Number(e.target.value) })}>
                <option value="">—</option>
                {sellers!.map((s) => <option key={s.id} value={s.id}>{s.company_name || `#${s.id}`}</option>)}
              </select>
            </div>)}
          <h3 style={{ marginTop: 16 }}>{t('import.mapping')}</h3>
          {unresolved.length > 0
            ? <p className="error" role="alert">{t('import.unresolved', { fields: unresolved.map((f) => t(`import.field.${f}`)).join(', ') })}</p>
            : <p className="muted small">{t('import.mapping_hint')}</p>}
          <div className="row">
            <div><label htmlFor="imp-hr">{t('import.header_row')}</label>
              <select id="imp-hr" value={imp.header_row} onChange={(e) => patch({ header_row: Number(e.target.value) })}>
                {Array.from({ length: 15 }, (_, i) => <option key={i} value={i}>{i + 1}</option>)}
              </select></div>
            {FIELDS.map((f) => (
              <div key={f}><label htmlFor={`m-${f}`}>{t(`import.field.${f}`)}{imp.required.includes(f) ? ' *' : ''}
                {imp.ai_fields?.includes(f) && <> <span className="tag">{t('import.ai_tag')}</span></>}
                {unresolved.includes(f) && <> <span className="tag bad">?</span></>}</label>
                <select id={`m-${f}`} value={imp.mapping[f] ?? ''} onChange={(e) => setCol(f, e.target.value)}>
                  <option value="">—</option>
                  {imp.headers.map((h: string, i: number) => <option key={i} value={i}>{h || `#${i + 1}`}</option>)}
                </select></div>))}
          </div>
          <div className="table-wrap"><table>
            <thead><tr>{imp.headers.map((h: string, i: number) => <th key={i}>{h}</th>)}</tr></thead>
            <tbody>{imp.preview?.map((r: string[], i: number) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
          </table></div>
          <button className="btn" disabled={busy || unresolved.length > 0 || (admin && !imp.seller)} onClick={confirm}>{t('import.confirm')}</button>
        </>
      )}
    </div>
  );
}
