"""Excel and PDF output for the accounting section. Amounts are whole so'm."""
import io
import os
from xml.sax.saxutils import escape

from django.http import HttpResponse

from .einvoice import provider

KIND_RU = {'commission': 'Счёт на агентское вознаграждение', 'seller_inv': 'Данные счёта-фактуры продавца',
           'act': 'Акт оказанных агентских услуг', 'registry': 'Реестр выплат продавцам', 'storno': 'Сторно'}
STATUS_RU = {'draft': 'черновик', 'posted': 'проведён', 'reversed': 'сторнирован'}
JOURNAL_HEAD = ['Номер', 'Дата', 'Вид', 'Статус', 'Продавец', 'ИНН продавца', 'Без НДС', 'Ставка НДС', 'НДС', 'Итого']
SUMMARY_ROWS = [('deals', 'Сделок'), ('turnover', 'Оборот сделок (транзит)'), ('held', 'Получено от клиентов'),
                ('commission', 'Комиссия BMG (выручка)'), ('commission_vat', 'НДС на комиссию'),
                ('payout_total', 'К выплате продавцам'), ('payout_outstanding', 'Ещё не выплачено'),
                ('refunded', 'Возвраты (сторно)')]


FORMULA_START = ('=', '+', '-', '@', '\t', '\r', '\n')


def safe(v):
    """Spreadsheet formula-injection guard (also tab / CR / LF and leading spaces); plain negative numbers stay."""
    s = '' if v is None else str(v)
    return "'" + s if s.lstrip(' ')[:1] in FORMULA_START and not s.lstrip('-').isdigit() else s


def journal_rows(docs):
    for d in docs:
        yield [d.number, d.date.isoformat(), KIND_RU.get(d.kind, d.kind), STATUS_RU.get(d.status, d.status),
               d.seller.company_name if d.seller else '', (d.payload.get('seller') or {}).get('inn', ''),
               d.base, f'{d.vat_rate}%', d.vat, d.total]


def xlsx(summary, docs, filename):
    from openpyxl import Workbook
    from openpyxl.styles import Font
    wb = Workbook()
    ws = wb.active
    ws.title = 'Сводка'
    ws.append([f'Период {summary["from"]} — {summary["to"]}'])
    ws['A1'].font = Font(bold=True, size=13)
    for key, label in SUMMARY_ROWS:
        ws.append([label, summary[key]])
    ws.column_dimensions['A'].width = 34
    j = wb.create_sheet('Документы')
    j.append(JOURNAL_HEAD)
    for c in j[1]:
        c.font = Font(bold=True)
    for row in journal_rows(docs):
        j.append([safe(v) if isinstance(v, str) else v for v in row])
    for col, w in zip('ABCDEFGHIJ', (16, 12, 34, 14, 28, 14, 14, 10, 12, 14)):
        j.column_dimensions[col].width = w
    buf = io.BytesIO()
    wb.save(buf)
    resp = HttpResponse(buf.getvalue(), content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    resp['Content-Disposition'] = f'attachment; filename="{filename}.xlsx"'
    return resp


FONT_PATHS = [os.environ.get('PDF_FONT', ''), '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
              '/usr/share/fonts/dejavu/DejaVuSans.ttf', '/Library/Fonts/Arial Unicode.ttf',
              '/System/Library/Fonts/Supplemental/Arial.ttf']


def _font():
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    if 'BMGSans' in pdfmetrics.getRegisteredFontNames():
        return 'BMGSans'
    for p in FONT_PATHS:
        if p and os.path.exists(p):
            pdfmetrics.registerFont(TTFont('BMGSans', p))
            return 'BMGSans'
    return 'Helvetica'      # no Cyrillic font found: set PDF_FONT to a TTF with Cyrillic glyphs


def money(v):
    return f'{int(v):,}'.replace(',', ' ')


def _pdf(title, blocks, filename):
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
    font = _font()
    ss = getSampleStyleSheet()
    for s in ss.byName.values():
        s.fontName = font
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=36, rightMargin=36, topMargin=36, bottomMargin=36, title=title)
    story = [Paragraph(title, ss['Title'])]
    for kind, data in blocks:
        if kind == 'p':
            story.append(Paragraph(data, ss['Normal']))
        elif kind == 'table':
            t = Table(data, repeatRows=1)
            t.setStyle(TableStyle([('FONT', (0, 0), (-1, -1), font, 8), ('GRID', (0, 0), (-1, -1), 0.4, colors.grey),
                                   ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#e8eef9'))]))
            story.append(t)
        story.append(Spacer(1, 8))
    doc.build(story)
    resp = HttpResponse(buf.getvalue(), content_type='application/pdf')
    resp['Content-Disposition'] = f'attachment; filename="{filename}.pdf"'
    return resp


def summary_pdf(summary, docs, filename):
    rows = [['Показатель', 'Сумма, сум']] + [[label, money(summary[k]) if k != 'deals' else summary[k]]
                                            for k, label in SUMMARY_ROWS]
    jr = [JOURNAL_HEAD[:4] + ['Продавец', 'Без НДС', 'НДС', 'Итого']]
    for r in journal_rows(docs[:500]):
        jr.append([r[0], r[1], r[2][:24], r[3], r[4][:22], money(r[6]), money(r[8]), money(r[9])])
    return _pdf(f'BMG — бухгалтерия, {summary["from"]} — {summary["to"]}',
                [('table', rows), ('p', 'Документы за период'), ('table', jr)], filename)


def party_lines(label, p):
    p = {k: escape(str(v)) if isinstance(v, str) else v for k, v in (p or {}).items()}
    s = f'<b>{label}:</b> {p.get("name") or "—"}, ИНН {p.get("inn") or "—"}'
    if p.get('address'):
        s += f', {p["address"]}'
    if p.get('bank_account'):
        s += f', р/с {p["bank_account"]}, МФО {p.get("bank_mfo", "")}, {p.get("bank_name", "")}'
    if 'vat_payer' in p:
        s += ', плательщик НДС' if p['vat_payer'] else ', не плательщик НДС'
    return ('p', s)


def document_pdf(d):
    pl = d.payload
    blocks = [('p', f'№ {d.number} от {d.date.isoformat()} · {STATUS_RU.get(d.status, d.status)}')]
    if d.kind == 'seller_inv':
        blocks += [party_lines('Продавец', pl.get('seller')), party_lines('Покупатель', pl.get('client'))]
    else:
        for key, label in (('bmg', 'Агент (BMG)'), ('seller', 'Принципал (продавец)')):
            if key in pl:
                blocks.append(party_lines(label, pl[key]))
    if d.period_start:
        blocks.append(('p', f'Период: {d.period_start} — {d.period_end}'))
    lines = pl.get('lines') or []
    if lines:
        keys = list(lines[0].keys())
        blocks.append(('table', [keys] + [[money(r[k]) if isinstance(r[k], int) else str(r[k]) for k in keys] for r in lines]))
    blocks.append(('table', [['Без НДС', f'НДС {d.vat_rate}%', 'Итого'], [money(d.base), money(d.vat), money(d.total)]]))
    if d.kind == 'storno':
        blocks.append(('p', f'Сторнирует документ {pl.get("reverses")}. Причина: {escape(str(pl.get("reason") or "—"))}'))
    return _pdf(KIND_RU.get(d.kind, d.kind), blocks, d.number)


def einvoice_json(d):
    import json
    data = provider().prepare(d)
    resp = HttpResponse(json.dumps(data, ensure_ascii=False, indent=2), content_type='application/json; charset=utf-8')
    resp['Content-Disposition'] = f'attachment; filename="{d.number}-einvoice.json"'
    return resp
