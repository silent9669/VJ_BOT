"""Build attributed RAG passages from bounded, locally captured publisher lessons.

No network, embeddings API or model execution. Rights basis is an operator assertion,
not an independently verified publisher license. NHK remains blocked for new access.
"""
import argparse
import hashlib
import json
import os
import re
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from scripts.crawl_learning_sources import publisher_url

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'static/course/learning-corpus.json'
PUBLISHERS = {
    'naoki': ('NK', 'Naoki', 'www.naoki.edu.vn'),
    'freetag': ('FT', 'FreeTag', 'freetag.jp'),
    'saromalang': ('SR', 'Saromalang', 'www.saromalang.com'),
    'mokumoku': ('MK', 'Mokumoku', 'mokumoku.vn'),
    'tiengnhatdongian': ('TN', 'Tiếng Nhật Đơn Giản', 'www.tiengnhatdongian.com'),
    'nhk': ('NH', 'NHK', 'www.nhk.or.jp'),
    'irodori': ('IR', 'Irodori', 'www.irodori.jpf.go.jp'),
}
AUTHORIZATION = {
    'basis': 'user_asserted_rights',
    'assertion': 'tôi đc toàn quyền crawl mmấycias đó, nhưng mà nhớ ghi lại nguồn để dễ truy vấn là dc ghi gọn nguồn chỗ tôi ghi ấy',
    'asserted_on': '2026-11-13',
    'publisher_permission_independently_verified': False,
    'scope': 'Operator authorizes bounded crawl, storage and RAG with source-first attribution; access restrictions still apply.',
}
MAX_FILE = 2_000_000
MAX_CHUNKS = 1500


def read_bounded(path: Path) -> bytes:
    with path.open('rb') as stream:
        raw = stream.read(MAX_FILE + 1)
    if len(raw) > MAX_FILE:
        raise ValueError(f'Evidence file exceeds limit: {path.name}')
    return raw


def capture_receipt(path: Path) -> tuple[str, int]:
    """Bound and hash binary PDF captures without copying them into the corpus."""
    digest = hashlib.sha256()
    size = 0
    with path.open('rb') as stream:
        while block := stream.read(1_000_000):
            size += len(block)
            if size > 30_000_000:
                raise ValueError(f'Capture exceeds binary byte limit: {path.name}')
            digest.update(block)
    return digest.hexdigest(), size


def passages(text: str, limit: int = 1400) -> list[str]:
    """Split exact contiguous source slices at paragraph, word or sentence boundaries."""
    result = []
    start = 0
    while start < len(text):
        end = min(start + limit, len(text))
        if end < len(text):
            boundary = text.rfind('\n\n', start + limit // 2, end)
            if boundary >= 0:
                end = boundary + 2
            else:
                candidates = [match.end() for match in re.finditer(r'\s+|[。！？.!?]', text[start:end])]
                if not candidates:
                    raise ValueError('Source token exceeds passage limit without a safe split')
                end = start + candidates[-1]
        result.append(text[start:end])
        start = end
    return result


def build_corpus(manifests: list[Path]) -> dict:
    documents, chunks, outcomes, seen = [], [], {}, set()
    for manifest_path in manifests:
        manifest = json.loads(read_bounded(manifest_path).decode('utf-8'))
        for outcome in manifest['outcomes']:
            ident = outcome['source_id']
            if ident not in PUBLISHERS or ident == 'nhk' or ident in outcomes:
                raise ValueError(f'Unknown, blocked or duplicated source outcome: {ident}')
            if outcome['status'] not in ('acquired', 'partial', 'blocked', 'failed'):
                raise ValueError(f'Invalid source outcome: {ident}')
            outcomes[ident] = {key: outcome[key] for key in ('source_id', 'status', 'reason')}
        for record in manifest['records']:
            ident = record['source_id']
            if ident not in outcomes or ident == 'nhk':
                raise ValueError(f'Missing outcome or blocked source record: {ident}')
            code, name, host = PUBLISHERS[ident]
            url = publisher_url(record['url'], host)
            if (ident, url) in seen:
                raise ValueError(f'Duplicate source document: {url}')
            seen.add((ident, url))
            if record.get('coverage') != 'lesson_body' or record.get('content_format') != 'markdown':
                raise ValueError(f'Not a selected teaching body: {url}')
            title = record['title']
            if not isinstance(title, str) or not title.strip() or len(title) > 300:
                raise ValueError(f'Invalid document title: {url}')
            content_path = Path(record['content_path'])
            capture_path = Path(record['capture_path'])
            content = read_bounded(content_path)
            text = content.decode('utf-8').strip()
            if len(text) < 80 or not re.search(r'[\u3040-\u30ff\u3400-\u9fff]', text):
                raise ValueError(f'Missing Japanese teaching material: {url}')
            capture_hash, capture_size = capture_receipt(capture_path)
            content_hash = hashlib.sha256(content).hexdigest()
            doc_id = code + '-' + hashlib.sha256((url + '\n' + text).encode()).hexdigest()[:12]
            document = {
                'id': doc_id, 'source_id': ident, 'source_name': name, 'url': url,
                'title': title.strip(), 'content_sha256': content_hash,
                'capture_sha256': capture_hash,
                'capture_bytes': capture_size, 'content_bytes': len(content),
                'captured_at': datetime.fromtimestamp(capture_path.stat().st_mtime, timezone.utc).isoformat(),
                'rights_basis': 'user_asserted_rights', 'review_status': 'unreviewed',
                'source_level': record.get('source_level'),
                'extraction_note': record.get('extraction_note', 'Selected teaching body; navigation/footer omitted; no AI rewriting.'),
            }
            documents.append(document)
            offset = 0
            for index, passage in enumerate(passages(text), 1):
                chunk_id = f'{doc_id}-{index}'
                chunks.append({
                    'id': chunk_id, 'document_id': doc_id, 'source_id': ident,
                    'source_name': name, 'url': url, 'title': document['title'],
                    'header': f'Nguồn: {name} [{chunk_id}] — {url}',
                    'text': passage, 'source_start': offset, 'source_end': offset + len(passage),
                    'review_status': 'unreviewed',
                })
                offset += len(passage)
    if set(outcomes) != set(PUBLISHERS) - {'nhk'}:
        raise ValueError('Each of the six accessible-source attempts requires an explicit outcome')
    for ident, outcome in outcomes.items():
        count = sum(document['source_id'] == ident for document in documents)
        if outcome['status'] in ('acquired', 'partial') and not count:
            raise ValueError(f'Acquisition claim without a document: {ident}')
        if outcome['status'] in ('failed', 'blocked') and count:
            raise ValueError(f'Blocked source unexpectedly contains documents: {ident}')
        outcome['documents'] = count
    outcomes['nhk'] = {
        'source_id': 'nhk', 'status': 'blocked', 'documents': 0,
        'reason': 'Known NHK AI-agent robots exclusion; no authorized alternate access route supplied. No new requests, lesson bodies, PDF or audio collected.',
    }
    if not chunks or len(chunks) > MAX_CHUNKS:
        raise ValueError('Empty or oversized passage corpus')
    result = {
        'version': 1, 'authorization': AUTHORIZATION,
        'capture_time_basis': 'Local capture-file modification time; not publisher publication date.',
        'coverage': [outcomes[ident] for ident in PUBLISHERS],
        'documents': documents, 'chunks': chunks,
    }
    if len(json.dumps(result, ensure_ascii=False).encode()) > 1_500_000:
        raise ValueError('Published corpus exceeds runtime asset budget')
    return result


def publish(manifests: list[Path], output: Path = OUT) -> dict:
    result = build_corpus(manifests)
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', newline='\n',
                                         dir=output.parent, delete=False) as stream:
            temporary = Path(stream.name)
            json.dump(result, stream, ensure_ascii=False, indent=2)
            stream.write('\n')
        os.replace(temporary, output)
    finally:
        if temporary:
            temporary.unlink(missing_ok=True)
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', type=Path, action='append', required=True)
    parser.add_argument('--output', type=Path, default=OUT)
    args = parser.parse_args()
    corpus = publish(args.manifest, args.output)
    print(f"Published {len(corpus['documents'])} source documents / {len(corpus['chunks'])} passages")
    for outcome in corpus['coverage']:
        print(f"{outcome['source_id']}: {outcome['status']} ({outcome['documents']} documents)")
