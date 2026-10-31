"""Index official Erin lesson metadata and links; keep videos/textbooks at the publisher."""
import hashlib
import json
import re
import time
import urllib.request
from datetime import datetime, timezone
from html import unescape
from pathlib import Path

BASE = 'https://www.erin.jpf.go.jp'
OUT = Path('static/course/erin-resources.json')


def fetch(url):
    request = urllib.request.Request(url, headers={'User-Agent': 'VJBot-Learning-Resource-Indexer/1.0'})
    with urllib.request.urlopen(request, timeout=30) as response:
        raw = response.read(2_000_000)
    return raw.decode('utf-8'), hashlib.sha256(raw).hexdigest()


def parse_lesson(html, number):
    heading = re.search(r'<h2 class="page-title-bar[^>]*>.*?<span class="text">(.*?)</span>', html, re.S)
    if not heading:
        raise ValueError(f'Missing heading: {number}')
    title = ' '.join(unescape(re.sub('<[^>]+>', ' ', heading[1])).split())
    resources = []
    for slug, label in [('basic', 'Hội thoại cơ bản'), ('advanced', 'Hội thoại mở rộng'), ('key-phrases', 'Mẫu câu'), ('vocabulary', 'Từ vựng')]:
        path = f'/en/lesson/{number:02d}/{slug}/'
        if f'href="{path}"' not in html:
            raise ValueError(f'Missing resource: {path}')
        resources.append({'title': label, 'url': BASE + path})
    return {'id': f'erin:{number:02d}', 'number': number, 'title': title,
            'book': 'erin', 'publisher': 'Japan Foundation',
            'page_url': f'{BASE}/en/lesson/{number:02d}/', 'resources': resources}


def crawl():
    lessons, pages = [], []
    for number in range(1, 26):
        url = f'{BASE}/en/lesson/{number:02d}/'
        html, digest = fetch(url)
        lessons.append(parse_lesson(html, number))
        pages.append({'url': url, 'sha256': digest})
        time.sleep(.15)
    terms = BASE + '/en/policy/'
    _, digest = fetch(terms)
    pages.append({'url': terms, 'sha256': digest})
    result = {'retrieved_at': datetime.now(timezone.utc).isoformat(), 'terms_url': terms,
              'method': 'Lesson titles and verified links only; no video, transcript or exercise copying.',
              'level_note': 'Supplementary beginner conversation; no official JLPT level equivalence.',
              'pages': pages, 'lessons': lessons}
    temporary = OUT.with_suffix('.tmp')
    temporary.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    temporary.replace(OUT)
    print(f'Indexed {len(lessons)} Erin lessons and {sum(len(l["resources"]) for l in lessons)} activity links.')


if __name__ == '__main__':
    crawl()
