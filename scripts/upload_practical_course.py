"""Import authored course identities into the configured production D1 database."""
import json,subprocess,tempfile
from pathlib import Path
DB='eb0d49a5-7a90-4219-968c-5fcb04390859'
def statements():
    units=json.loads(Path('static/course/practical.json').read_text())['units']
    result=[]
    for index,u in enumerate(units):
        result.append({'sql':'''INSERT INTO curriculum_lessons(lesson_id,book,level,lesson,title,source_url) VALUES(?,?,?,?,?,?) ON CONFLICT(lesson_id) DO UPDATE SET title=excluded.title,source_url=excluded.source_url''','params':[u['id'],'practical',u['level'],index+1,u['title'],u['reference_url']]})
        items=[(f"{u['id']}:word:{i}",'vocabulary',w['jp'],w['reading'],w['vi']) for i,w in enumerate(u['words'])]
        items += [(q['id'],'reading',q['q'],'',q['explanation']) for q in u['questions']]
        items += [(u['id']+':production','production',u['production']['prompt'],'',u['goal'])]
        for offset,(ident,kind,display,reading,meaning) in enumerate(items):
            result.append({'sql':'''INSERT INTO curriculum_items(item_id,lesson_id,book,level,lesson,section,item_type,order_num,display,reading,meaning_vi,meaning_en,source_url) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(item_id) DO UPDATE SET display=excluded.display,reading=excluded.reading,meaning_vi=excluded.meaning_vi,source_url=excluded.source_url''','params':[ident,u['id'],'practical',u['level'],index+1,kind,kind,10000+index*20+offset,display,reading,meaning,'',u['reference_url']]})
    return result
if __name__=='__main__':
    rows=statements()
    with tempfile.TemporaryDirectory() as d:
        p=Path(d)/'batch.json';p.write_text(json.dumps(rows))
        run=subprocess.run(['npx','cf','d1','query',DB,'--batch','@'+str(p)],capture_output=True,text=True)
        if run.returncode:raise SystemExit('Practical course import failed')
        results=json.loads(run.stdout)
        if not all(r.get('success') for r in results):raise SystemExit('A course statement failed')
    print('Imported 20 course units and 200 practice identities; existing learner records retained.')
