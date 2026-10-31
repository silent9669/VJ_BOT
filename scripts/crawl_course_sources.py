"""Bounded metadata crawl of official learning resources; no textbook/audio mirroring."""
import hashlib,json,re,time,urllib.request,urllib.parse
from html import unescape
from datetime import datetime,timezone
from pathlib import Path
BASE='https://www.irodori.jpf.go.jp'
OUT=Path('static/course/sources.json')
def fetch(url):
    request=urllib.request.Request(url,headers={'User-Agent':'VJBot-Learning-Resource-Indexer/1.0','Accept':'text/html'})
    with urllib.request.urlopen(request,timeout=30) as response:
        raw=response.read(2_000_000)
        return raw.decode('utf-8'),hashlib.sha256(raw).hexdigest()
def clean(text):return ' '.join(unescape(re.sub('<[^>]+>',' ',text)).split())
def crawl():
    pages=[];lessons=[]
    for book in ['starter','elementary01','elementary02','pre-intermediate']:
        url=f'{BASE}/en/{book}/pdf.html';html,digest=fetch(url)
        pages.append({'url':url,'sha256':digest})
        for block in re.findall(r'<li[^>]*>(.*?)</li>',html,re.S):
            heading=re.search(r'<h4[^>]*>(.*?)</h4>',block,re.S)
            if not heading:continue
            title=clean(heading.group(1));number=re.search(r'Lesson\s*(\d+)',title)
            if not number:continue
            number=int(number.group(1));links=[urllib.parse.urljoin(url,unescape(h)) for h in re.findall(r'href="([^"]+)"',block)]
            pdf=next((h for h in links if re.search(r'_L\d+\.pdf$',h)),None)
            audio=next((h for h in links if '/audio/lesson' in h),None)
            if not pdf:continue
            tracks=[]
            if audio:
                time.sleep(.08)
                audio_html,audio_hash=fetch(audio);pages.append({'url':audio,'sha256':audio_hash})
                tracks=list(dict.fromkeys(urllib.parse.urljoin(audio,unescape(h)) for h in re.findall(r'(?:href|src)="([^"]+\.mp3)"',audio_html)))
            lessons.append({'id':f'irodori:{book}:{number}','publisher':'Japan Foundation','book':book,'number':number,'title':title,'page_url':url,'pdf_url':pdf,'audio_page_url':audio,'audio_track_urls':tracks,'usage':'External reference; textbook and audio remain on publisher site.'})
        print(book,len([x for x in lessons if x['book']==book]),flush=True)
    for url in ['https://www.jlpt.jp/e/about/levelsummary.html','https://www.jlpt.jp/e/samples/forlearners.html',BASE+'/en/about.html',BASE+'/en/privacy.html']:
        html,digest=fetch(url);pages.append({'url':url,'sha256':digest})
    if len(lessons)!=72 or len({x['id'] for x in lessons})!=72:
        raise ValueError('Expected 72 unique lessons; output not replaced')
    for book in ['starter','elementary01','elementary02','pre-intermediate']:
        if {x['number'] for x in lessons if x['book']==book} != set(range(1,19)):
            raise ValueError('Incomplete book; output not replaced')
    result={'retrieved_at':datetime.now(timezone.utc).isoformat(),'method':'HTML metadata and link extraction; no PDF, transcript or audio copying','terms_url':BASE+'/en/privacy.html','pages':pages,'lessons':lessons}
    OUT.parent.mkdir(parents=True,exist_ok=True);OUT.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    print('Indexed',len(lessons),'lessons;',sum(len(x['audio_track_urls']) for x in lessons),'audio links')
if __name__=='__main__':crawl()
