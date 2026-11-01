"""Index official JLPT workbook links; copyrighted materials stay at jlpt.jp."""
import hashlib
import json
import re
import urllib.request
from urllib.parse import urljoin, urlparse
from datetime import datetime, timezone
from pathlib import Path

URL = 'https://www.jlpt.jp/e/samples/sampleindex.html'
OUT = Path('static/course/jlpt-resources.json')
YEARS = ('2012', '2018')
LABELS = {'V': 'Từ vựng', 'G': 'Ngữ pháp', 'R': 'Đọc hiểu', 'L': 'Nghe hiểu',
          'answer': 'Đáp án', 'sheet': 'Phiếu trả lời', 'script': 'Bản chép lời'}


def parse_resources(html):
    rows = {}
    for href in re.findall(r'href=["\']([^"\']+)["\']', html):
        url = urljoin(URL, href)
        if urlparse(url).netloc != 'www.jlpt.jp':
            continue
        match = re.search(r'/sample(2012|2018)/(pdf|mp3)/(N[1-5])([A-Za-z0-9]+)\.(pdf|mp3)$', url)
        if not match:
            continue
        year, _, level, kind, extension = match.groups()
        ident = f'jlpt:{year}:{level}:{kind}'
        rows[ident] = {'id': ident, 'year': year, 'level': level,
                       'title': LABELS.get(kind, 'Âm thanh ' + kind),
                       'kind': 'audio' if extension == 'mp3' else 'document', 'url': url}
    for year in YEARS:
        for level in ['N5', 'N4', 'N3', 'N2', 'N1']:
            group = [r for r in rows.values() if r['year'] == year and r['level'] == level]
            keys = {r['id'].split(':')[-1] for r in group}
            if not {'V', 'G', 'R', 'L', 'answer', 'sheet', 'script'}.issubset(keys) or not any(r['kind'] == 'audio' for r in group):
                raise ValueError(f'Incomplete official workbook links: {year} {level}; output not replaced')
    return list(rows.values())


def crawl():
    request = urllib.request.Request(URL, headers={'User-Agent': 'VJBot-Learning-Resource-Indexer/1.0'})
    with urllib.request.urlopen(request, timeout=40) as response:
        raw = response.read(2_000_000)
    rows = parse_resources(raw.decode('utf-8'))
    data = {'publisher': 'Japan Foundation / Japan Educational Exchanges and Services',
            'source_url': URL, 'terms_url': 'https://www.jlpt.jp/e/policy.html',
            'retrieved_at': datetime.now(timezone.utc).isoformat(), 'sha256': hashlib.sha256(raw).hexdigest(),
            'usage': 'External links only; no questions, transcripts or audio reproduced. Official practice workbooks are not a complete course.',
            'resources': rows}
    temporary = OUT.with_suffix('.tmp')
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
    temporary.replace(OUT)
    print('Indexed official JLPT resources:', len(rows), 'across N5–N1, 2012 and 2018')


if __name__ == '__main__':
    crawl()
