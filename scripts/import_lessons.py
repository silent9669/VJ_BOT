"""Reproducible OpenJLPT import. Derived dataset: CC BY-SA 4.0."""
import json, urllib.request, hashlib
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
REV = '0d1d3410bec90bd4098a7c72de820543cb4f707c'
BASE = f'https://raw.githubusercontent.com/evanclan/OpenJLPT/{REV}/'
OUT = Path('static/openjlpt')
def fetch(path):
    with urllib.request.urlopen(BASE + path, timeout=60) as r: return r.read()
def main():
    OUT.mkdir(parents=True, exist_ok=True)
    jobs=[(kind,level) for level in ['n5','n4','n3','n2','n1'] for kind in ['vocab','grammar','kanji']]
    records=[]; counts={}; checksums={}
    def get(job):
        kind,level=job; return kind,level,fetch(f'data/json/{kind}/{level}.json')
    for kind,level,raw in ThreadPoolExecutor(max_workers=5).map(get,jobs):
        rows=json.loads(raw); name=f'{kind}-{level}.json'
        (OUT/name).write_bytes(raw)
        counts[name]=len(rows); checksums[name]=hashlib.sha256(raw).hexdigest()
        for i,row in enumerate(rows):
            typ={'vocab':'vocabulary','grammar':'grammar','kanji':'kanji'}[kind]
            ident=str(row.get('id') or row.get('character'))
            meaning=row.get('meanings',row.get('meaning',''))
            if isinstance(meaning,list): meaning='; '.join(meaning)
            records.append({'item_id':f'openjlpt:{level.upper()}:{typ}:{ident}', 'lesson_id':f'openjlpt:{level.upper()}:{typ}:{i//20+1}', 'book':'openjlpt', 'level':level.upper(), 'lesson':i//20+1, 'section':typ, 'item_type':typ, 'order_num':i+1, 'display':row.get('word') or row.get('pattern') or row.get('character'), 'reading':row.get('reading') or row.get('romaji') or '; '.join(row.get('onyomi',[])+row.get('kunyomi',[])), 'meaning_vi':'', 'meaning_en':meaning, 'source_url':f'https://github.com/evanclan/OpenJLPT/tree/{REV}'})
    (OUT/'NOTICE.md').write_bytes(fetch('NOTICE.md'))
    (OUT/'LICENSE').write_bytes(fetch('LICENSE'))
    (OUT/'manifest.json').write_text(json.dumps({'source':'https://github.com/evanclan/OpenJLPT','revision':REV,'license':'CC-BY-SA-4.0','counts':counts,'sha256':checksums},indent=2)+'\n')
    Path('data').mkdir(exist_ok=True)
    Path('data/openjlpt-items.json').write_text(json.dumps(records,ensure_ascii=False))
    def quote(v): return str(v) if isinstance(v,int) else "'"+str(v).replace("'","''")+"'"
    Path('data/openjlpt.sql').write_text('\n'.join('INSERT INTO curriculum_items ('+','.join(r)+') VALUES ('+','.join(map(quote,r.values()))+') ON CONFLICT(item_id) DO UPDATE SET display=excluded.display, reading=excluded.reading, meaning_en=excluded.meaning_en, source_url=excluded.source_url;' for r in records))
    print(json.dumps(counts,indent=2)); print('Total:',len(records))
if __name__=='__main__': main()
