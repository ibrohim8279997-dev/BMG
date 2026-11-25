"""E-invoice (electronic invoice / ESF) integration layer.

Interface: prepare(doc) -> dict, send(doc) -> ref, status(doc) -> str.

Stage 1 (now): `ManualExport` builds the data and exports it for manual upload to the operator's web cabinet.
The export is BMG's OWN neutral JSON: it is NOT any operator's format, and no operator URL is assumed.

TODO before a direct connection (questions for the accountant / operator):
  1. Which e-invoice operator will BMG use, and its API documentation (format, auth, test environment)?
  2. Who signs: BMG's EDS key for commission invoices; the seller's own key for its invoice to the client?
  3. Product classifier codes (MXIK / IKPU) and units required per line: where do we get them for each product?
  4. Is a separate e-invoice needed per deal, or one per period with the act?
  5. Required fields for individuals as buyers (none / PINFL)? We do not store passport data on documents.
"""
from django.conf import settings

from apps.core.models import Setting

from .models import Document


class NotConfigured(Exception):
    pass


class Provider:
    def prepare(self, doc: Document) -> dict:
        raise NotImplementedError

    def send(self, doc: Document) -> str:
        raise NotImplementedError

    def status(self, doc: Document) -> str:
        raise NotImplementedError


def _party(p):
    return {'name': (p or {}).get('name', ''), 'inn': (p or {}).get('inn', ''), 'address': (p or {}).get('address', ''),
            'vat_payer': bool((p or {}).get('vat_payer'))}


class ManualExport(Provider):
    def prepare(self, doc):
        pl = doc.payload
        if doc.kind == Document.Kind.COMMISSION_INVOICE:
            supplier, buyer = pl.get('bmg'), pl.get('seller')
        elif doc.kind == Document.Kind.SELLER_INVOICE:
            supplier, buyer = pl.get('seller'), pl.get('client')
        else:
            raise NotConfigured('not_an_invoice')
        return {
            'format': 'bmg-einvoice-export/1',     # BMG's internal format, for manual entry; not an operator schema
            'document': {'number': doc.number, 'date': doc.date.isoformat(), 'kind': doc.kind},
            'supplier': _party(supplier), 'buyer': _party(buyer),
            'contract': {'number': (pl.get('seller') or {}).get('contract_number', ''),
                         'date': (pl.get('seller') or {}).get('contract_date', '')},
            'amounts': {'currency': 'UZS', 'without_vat': doc.base, 'vat_rate': str(doc.vat_rate), 'vat': doc.vat,
                        'total': doc.total},
            'lines': pl.get('lines', []),
            'todo': ['product classifier codes (MXIK) per line', 'operator-specific fields'],
        }

    def send(self, doc):
        raise NotConfigured('manual_upload_only')

    def status(self, doc):
        return doc.einvoice_status or 'not_sent'


class OperatorApi(ManualExport):
    """Direct operator connection. Deliberately a stub: the operator and its API are not chosen yet (see TODO)."""

    def send(self, doc):
        if not getattr(settings, 'EINVOICE_OPERATOR_URL', ''):
            raise NotConfigured('operator_not_configured')
        raise NotImplementedError('TODO: implement after the operator and its API spec are confirmed')

    def status(self, doc):
        raise NotImplementedError('TODO: implement after the operator and its API spec are confirmed')


def provider() -> Provider:
    return OperatorApi() if Setting.get('einvoice_api_enabled') else ManualExport()
