"""Server-side file validation by CONTENT (magic bytes / structure), never by extension.

Allowed: photos (jpeg/png/webp), xlsx, docx, pdf. Old .doc/.xls (OLE2) are rejected.
"""
import io
import uuid
import zipfile
from pathlib import Path

from django.conf import settings

MB = 1024 * 1024
LIMITS = {'document': 5 * MB, 'photo': 10 * MB, 'excel': 20 * MB}
MAX_PDF_PAGES = 2
MAX_UNZIPPED = 200 * MB      # zip-bomb guard
MAX_ZIP_RATIO = 200


class UploadError(Exception):
    def __init__(self, code):
        self.code = code
        super().__init__(code)


def _zip_kind(data: bytes):
    try:
        z = zipfile.ZipFile(io.BytesIO(data))
        infos = z.infolist()
    except zipfile.BadZipFile:
        raise UploadError('invalid_file')
    total = sum(i.file_size for i in infos)
    comp = sum(i.compress_size for i in infos) or 1
    if total > MAX_UNZIPPED or total / comp > MAX_ZIP_RATIO:
        raise UploadError('invalid_file')
    names = {i.filename for i in infos}
    if any(n.startswith('/') or '..' in n.split('/') for n in names):
        raise UploadError('invalid_file')
    if 'xl/workbook.xml' in names:
        return 'xlsx'
    if 'word/document.xml' in names:
        return 'docx'
    raise UploadError('invalid_file')


def detect(data: bytes) -> str:
    if data[:8] == b'\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1':
        raise UploadError('legacy_format_not_allowed')   # .doc / .xls
    if data[:3] == b'\xff\xd8\xff':
        return 'jpeg'
    if data[:8] == b'\x89PNG\r\n\x1a\n':
        return 'png'
    if data[:4] == b'RIFF' and data[8:12] == b'WEBP':
        return 'webp'
    if data[:5] == b'%PDF-':
        return 'pdf'
    if data[:4] == b'PK\x03\x04':
        return _zip_kind(data)
    raise UploadError('invalid_file')


def _check_pdf(data):
    from pypdf import PdfReader
    from pypdf.errors import PyPdfError
    try:
        r = PdfReader(io.BytesIO(data))
        if r.is_encrypted:
            raise UploadError('invalid_file')
        n = len(r.pages)
    except UploadError:
        raise
    except (PyPdfError, Exception):
        raise UploadError('invalid_file')
    if n > MAX_PDF_PAGES or n < 1:
        raise UploadError('pdf_too_long')


def _check_image(data):
    from PIL import Image
    try:
        with Image.open(io.BytesIO(data)) as im:
            im.verify()
            if im.width * im.height > 60_000_000:
                raise UploadError('invalid_file')
    except UploadError:
        raise
    except Exception:
        raise UploadError('invalid_file')


ALLOWED = {'photo': {'jpeg', 'png', 'webp'}, 'document': {'docx', 'pdf'}, 'excel': {'xlsx'}}
CONTENT_TYPES = {'jpeg': 'image/jpeg', 'png': 'image/png', 'webp': 'image/webp', 'pdf': 'application/pdf',
                 'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                 'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}


def validate(upload, category: str):
    """Returns (kind, bytes). category in LIMITS."""
    if category not in LIMITS:
        raise UploadError('invalid_file')
    if upload.size > LIMITS[category]:
        raise UploadError('file_too_large')
    data = upload.read(LIMITS[category] + 1)
    if len(data) > LIMITS[category]:
        raise UploadError('file_too_large')
    kind = detect(data)
    if kind not in ALLOWED[category]:
        raise UploadError('type_not_allowed')
    if kind == 'pdf':
        _check_pdf(data)
    elif kind in ('jpeg', 'png', 'webp'):
        _check_image(data)
    return kind, data


def store(data: bytes, kind: str) -> str:
    """Write under PRIVATE_MEDIA_ROOT with a random name; returns relative path. Never executed/served directly."""
    root = Path(settings.PRIVATE_MEDIA_ROOT)
    root.mkdir(parents=True, exist_ok=True)
    name = f'{uuid.uuid4().hex}.{kind}'
    (root / name).write_bytes(data)
    return name


def open_stored(name: str) -> bytes:
    root = Path(settings.PRIVATE_MEDIA_ROOT).resolve()
    p = (root / name).resolve()
    if root not in p.parents:
        raise UploadError('invalid_file')
    return p.read_bytes()
