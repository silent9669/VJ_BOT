"""Upload generated lesson SQL in restartable, idempotent batches using cf authentication."""
import json, subprocess, tempfile
from pathlib import Path
DB='eb0d49a5-7a90-4219-968c-5fcb04390859'
statements=Path('data/openjlpt.sql').read_text().splitlines()
with tempfile.TemporaryDirectory() as folder:
    batch=Path(folder)/'batch.json'
    for start in range(0,len(statements),250):
        batch.write_text(json.dumps([{'sql':s} for s in statements[start:start+250]]))
        result=subprocess.run(['npx','cf','d1','query',DB,'--batch','@'+str(batch)],capture_output=True,text=True)
        if result.returncode:
            print(result.stderr[-2000:]);raise SystemExit('Import failed at row '+str(start))
        data=json.loads(result.stdout)
        if any(not row.get('success',False) for row in data):raise SystemExit('Batch returned failure at '+str(start))
        print(f'Imported {min(start+250,len(statements))}/{len(statements)}',flush=True)
    result=subprocess.run(['npx','cf','d1','query',DB,'--sql',"INSERT OR IGNORE INTO curriculum_lessons(lesson_id,book,level,lesson,title,source_url) SELECT lesson_id,book,level,lesson,section || ' ' || lesson,source_url FROM curriculum_items WHERE book='openjlpt' GROUP BY lesson_id"],capture_output=True,text=True)
    if result.returncode:raise SystemExit(result.stderr[-1000:])
