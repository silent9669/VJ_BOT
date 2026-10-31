"""Fetch publisher resource links and timing; retain external documents at their source."""
import json,re,subprocess,hashlib,unicodedata
from pathlib import Path
from urllib.parse import urljoin
from datetime import datetime,timezone
BASE='https://www.jlpt.jp'
def fetch(url):
    return subprocess.check_output(['curl','-fsSL','--max-time','30',url])
times={'N5':[20,40,30],'N4':[25,55,35],'N3':[30,70,40],'N2':[105,50],'N1':[110,55]}
pages={'2012':BASE+'/e/samples/sampleindex.html','2018':BASE+'/e/samples/sampleindex.html'}
papers=[]
for year,url in pages.items():
    raw=fetch(url);html=raw.decode('utf8');links=list(dict.fromkeys(urljoin(url,x) for x in re.findall(r'(?:href|src)=["\']([^"\']+\.(?:pdf|mp3))["\']',html)))
    for level,minutes in times.items():
        matching=[u for u in links if f'/{level}' in u and f'sample{year}/' in u]
        if not matching:raise ValueError('Missing publisher links: '+level+year)
        groups=[('Từ vựng',['V']),('Ngữ pháp & đọc hiểu',['G','R']),('Nghe hiểu',['L'])] if level in ['N5','N4','N3'] else [('Từ vựng, ngữ pháp & đọc hiểu',['V','G','R']),('Nghe hiểu',['L'])]
        sections=[]
        for (name,codes),duration in zip(groups,minutes):
            documents=[{'title':{'V':'Từ vựng','G':'Ngữ pháp','R':'Đọc hiểu','L':'Nghe hiểu'}[code],'url':next(u for u in matching if u.endswith(f'{level}{code}.pdf'))} for code in codes]
            audio=[u for u in matching if u.endswith('.mp3')] if codes==['L'] else []
            sections.append({'title':name,'minutes':duration,'documents':documents,'audio':audio})
        answer=next(u for u in matching if u.endswith('answer.pdf'))
        papers.append({'level':level,'year':year,'sections':sections,'answer_url':answer,'sheet_url':next(u for u in matching if u.endswith('sheet.pdf')),'source_url':url,'source_sha256':hashlib.sha256(raw).hexdigest()})
        pdf=fetch(answer);path=Path('/tmp')/f'vj-answer-{year}-{level}.pdf';path.write_bytes(pdf)
        subprocess.run(['pdftotext','-layout',str(path),str(path.with_suffix('.txt'))],check=True)
for paper in papers:
    paper['answer_sha256']=hashlib.sha256(Path(f'/tmp/vj-answer-{paper["year"]}-{paper["level"]}.pdf').read_bytes()).hexdigest()
    text=unicodedata.normalize('NFKC',Path(f'/tmp/vj-answer-{paper["year"]}-{paper["level"]}.txt').read_text())
    parts=text.split('●')[1:]
    assert len(parts)==len(paper['sections']),(paper['year'],paper['level'],len(parts))
    for section,part in zip(paper['sections'],parts):
        groups=[]
        for match in re.finditer(r'問題\s*(\d+)(.*?)(?=問題|\Z)',part,re.S):
            n,block=match.groups();lines=[line.strip() for line in block.splitlines() if line.strip()]
            answers=[];labels=[]
            if '(1)' in block or '(2)' in block or '質問' in block:
                # Integrated listening: the last item has two subquestions.
                numeric=[re.findall(r'\d+',l) for l in lines if re.fullmatch(r'[\d\s]+',l)]
                answers=next(list(map(int,row)) for row in reversed(numeric) if len(row)==4 and all(1<=int(x)<=4 for x in row));labels=['1','2','3(1)','3(2)'];assert len(answers)==4
            else:
                expect_answer=False;skip_example=False
                for line in lines:
                    if re.fullmatch(r'[\d\s例]+',line):
                        numbers=[int(x) for x in re.findall(r'\d+',line)]
                        if expect_answer:
                            answers.extend(numbers[1:] if skip_example else numbers);labels.extend(pending_labels);expect_answer=False
                        else:
                            expect_answer=True;skip_example='例' in line;pending_labels=[str(x) for x in numbers]
            assert answers and all(1<=a<=4 for a in answers),(paper['year'],paper['level'],n,answers)
            assert len(labels)==len(answers),(paper['year'],paper['level'],n,labels,answers,block)
            choices=3 if section['audio'] and ((paper['level'] in ['N5','N4'] and int(n)>=3) or (paper['level']=='N3' and int(n)>=4) or (paper['level'] in ['N2','N1'] and int(n)==4)) else 4
            groups.append({'number':int(n),'answers':answers,'labels':labels,'choices':choices})
        section['groups']=groups
config={'retrieved_at':datetime.now(timezone.utc).isoformat(),'timing_source':BASE+'/e/guideline/testsections.html','notice':'Official practice workbooks, not current live exams. Current section timings applied to older practice papers; listening length may differ. Documents and audio remain at jlpt.jp. Self-assessment is not an official scaled JLPT score.','papers':papers}
Path('static/course/exams.json').write_text(json.dumps(config,ensure_ascii=False,indent=2)+'\n')
print(f'Fetched {len(papers)} official workbooks, {sum(len(s["audio"]) for p in papers for s in p["sections"])} audio links.')
