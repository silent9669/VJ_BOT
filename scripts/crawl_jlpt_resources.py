"""Index official JLPT workbook links by level; copyrighted materials stay at jlpt.jp."""
import hashlib,json,re,urllib.request,urllib.parse
from datetime import datetime,timezone
from pathlib import Path
URL='https://www.jlpt.jp/e/samples/sampleindex.html'
def crawl():
    with urllib.request.urlopen(urllib.request.Request(URL,headers={'User-Agent':'VJBot-Learning-Resource-Indexer/1.0'}),timeout=40) as r:raw=r.read()
    html=raw.decode('utf-8');rows=[]
    labels={'V':'Từ vựng','G':'Ngữ pháp','R':'Đọc hiểu','L':'Nghe hiểu','answer':'Đáp án','sheet':'Phiếu trả lời','script':'Bản chép lời'}
    for href in dict.fromkeys(re.findall(r'href="([^"]+)"',html)):
        match=re.search(r'/sample2018/(pdf|mp3)/(N[1-5])([A-Za-z0-9]+)\.(pdf|mp3)$',href)
        if not match:continue
        _,level,kind,extension=match.groups()
        rows.append({'id':f'jlpt:2018:{level}:{kind}','level':level,'title':labels.get(kind,'Âm thanh '+kind),'kind':'audio' if extension=='mp3' else 'document','url':urllib.parse.urljoin(URL,href)})
    for level in ['N5','N4','N3','N2','N1']:
        keys={x['id'].split(':')[-1] for x in rows if x['level']==level}
        if not {'V','G','R','L','answer','script'}.issubset(keys):raise ValueError('Incomplete official workbook links: '+level)
    data={'publisher':'Japan Foundation / Japan Educational Exchanges and Services','source_url':URL,'terms_url':'https://www.jlpt.jp/e/policy.html','retrieved_at':datetime.now(timezone.utc).isoformat(),'sha256':hashlib.sha256(raw).hexdigest(),'usage':'External links only; no questions, transcripts or audio reproduced. Official practice workbooks are not a complete course.','resources':rows}
    Path('static/course/jlpt-resources.json').write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
    print('Indexed official JLPT resources:',len(rows),'across N5–N1')
if __name__=='__main__':crawl()
