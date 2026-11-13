"""Import bounded Agent Reach captures into an external-reference catalog.

This command performs no network requests and never publishes captured page bodies.
Publisher permission decisions are curated separately; captures cannot grant reuse.
"""
import argparse
import hashlib
import json
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
CATALOG = ROOT / 'static/course/learning-sources.json'
MAX_CAPTURE_BYTES = 2_000_000
SOURCES = {
    'naoki': ('www.naoki.edu.vn', ('naoki.json', 'naoki-wa.json')),
    'freetag': ('freetag.jp', ('freetag.json', 'freetag-sources.json')),
    'saromalang': ('www.saromalang.com', ('saromalang.json',)),
    'mokumoku': ('mokumoku.vn', ('mokumoku.json',)),
    'tiengnhatdongian': ('www.tiengnhatdongian.com', ('tiengnhatdongian.json',)),
    'nhk': ('www.nhk.or.jp', ('nhk.json',)),
    'irodori': ('www.irodori.jpf.go.jp', ('irodori.json', 'irodori-editions.json')),
}
FIELDS = (
    'id', 'name', 'description_vi', 'access_kind', 'permission_status',
    'permission_note_vi', 'assessed_at',
)
PERMISSION_STATES = {'permission_required', 'unresolved', 'restricted'}
ACCESS_KINDS = {'lesson_read', 'index_read', 'shell_only'}


def publisher_url(value: object, host: str) -> str:
    """Accept public HTTPS links on this publisher only, not arbitrary targets."""
    if not isinstance(value, str):
        raise ValueError('Publisher URL must be a string')
    parsed = urlsplit(value)
    allowed_hosts = {host}
    if host == 'www.nhk.or.jp':
        allowed_hosts.add('www3.nhk.or.jp')
    if host == 'www.irodori.jpf.go.jp':
        allowed_hosts.add('hn.jpf.go.jp')
    if (parsed.scheme != 'https' or parsed.hostname not in allowed_hosts
            or parsed.username or parsed.password or parsed.port not in (None, 443)):
        raise ValueError(f'Unexpected publisher URL: {value}')
    return value


def metadata_fields(value: object, fields: tuple[str, ...]) -> dict:
    """Project only known string fields; do not retain nested body/raw payloads."""
    if not isinstance(value, dict):
        raise ValueError('Expected a metadata record')
    result = {}
    for field in fields:
        text = value.get(field)
        if not isinstance(text, str) or not text.strip():
            raise ValueError(f'Missing metadata string: {field}')
        result[field] = text
    return result


def capture_metadata(path: Path, host: str) -> dict:
    """Hash the exact capture JSON, not an inferred upstream HTTP response."""
    with path.open('rb') as stream:
        raw = stream.read(MAX_CAPTURE_BYTES + 1)
    if len(raw) > MAX_CAPTURE_BYTES:
        raise ValueError(f'Capture exceeds byte limit: {path.name}')
    capture = json.loads(raw.decode('utf-8'))
    if (capture.get('ok') is not True or capture.get('channel') != 'web'
            or capture.get('action') != 'read'):
        raise ValueError(f'Unsuccessful web read: {path.name}')
    if capture.get('backend') != 'jina':
        raise ValueError(f'Unsupported captured backend: {path.name}')
    items = capture.get('items')
    if not isinstance(items, list) or len(items) != 1:
        raise ValueError(f'Expected one captured page: {path.name}')
    item = items[0]
    text = item.get('text')
    if not isinstance(text, str) or not text.strip():
        raise ValueError(f'Empty captured page: {path.name}')
    return {
        'url': publisher_url(item.get('url'), host),
        'method': 'Agent Reach web/read (jina)',
        'capture_file': path.name,
        'capture_sha256': hashlib.sha256(raw).hexdigest(),
        'capture_bytes': len(raw),
        'captured_at': datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat(),
    }


def build_catalog(catalog: dict, evidence_dir: Path) -> dict:
    sources = catalog.get('sources')
    if not isinstance(sources, list) or len(sources) != len(SOURCES):
        raise ValueError('Expected all seven source assessments')
    if {row.get('id') for row in sources} != set(SOURCES):
        raise ValueError('Missing, duplicate or unknown source assessment')
    rows = []
    for source in sources:
        ident = source['id']
        host, files = SOURCES[ident]
        if source.get('corpus_allowed') is not False:
            raise ValueError(f'Reference-only importer cannot grant corpus reuse: {ident}')
        if (source.get('permission_status') not in PERMISSION_STATES
                or source.get('access_kind') not in ACCESS_KINDS):
            raise ValueError(f'Unreviewed permission/access state: {ident}')
        row = metadata_fields(source, FIELDS)
        for field, keys in (
            ('links', ('title', 'url')),
            ('policy_evidence', ('url', 'checked_at', 'finding')),
        ):
            entries = source.get(field)
            if not isinstance(entries, list) or not entries:
                raise ValueError(f'Missing metadata list: {ident}/{field}')
            row[field] = [metadata_fields(entry, keys) for entry in entries]
            for entry in row[field]:
                publisher_url(entry['url'], host)
        row['robots'] = metadata_fields(source.get('robots'), ('url', 'status', 'finding'))
        publisher_url(row['robots']['url'], host)
        row['corpus_allowed'] = False
        row['captures'] = [capture_metadata(evidence_dir / name, host) for name in files]
        rows.append(row)
    return {
        'version': 1,
        'scope': 'External learning references only; no lesson, exercise, transcript, PDF or audio bodies.',
        'capture_time_basis': 'Local capture-file modification time; not the publisher publication date.',
        'sources': rows,
    }


def collect(evidence_dir: Path, catalog_path: Path = CATALOG, output: Path | None = None) -> dict:
    catalog = json.loads(catalog_path.read_text(encoding='utf-8'))
    result = build_catalog(catalog, evidence_dir)
    destination = output if output is not None else catalog_path
    serialized = json.dumps(result, ensure_ascii=False, indent=2) + '\n'
    # Validate every source before opening a staged output; preserve the old catalog on failure.
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', newline='\n',
                                     dir=destination.parent, delete=False) as staged:
        temporary = Path(staged.name)
        try:
            staged.write(serialized)
        except BaseException:
            staged.close()
            temporary.unlink(missing_ok=True)
            raise
    try:
        os.replace(temporary, destination)
    finally:
        temporary.unlink(missing_ok=True)
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--evidence-dir', type=Path, required=True,
                        help='Directory containing the ten named Agent Reach web/read captures')
    parser.add_argument('--catalog', type=Path, default=CATALOG,
                        help='Curated seven-source assessments; page content cannot change permission')
    parser.add_argument('--output', type=Path, help='Defaults to updating --catalog atomically')
    args = parser.parse_args()
    result = collect(args.evidence_dir, args.catalog, args.output)
    print(f"Imported {len(result['sources'])} external-reference sources; 0 bodies cleared for corpus/RAG")


if __name__ == '__main__':
    main()
