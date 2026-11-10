"""Fill static/course/vi-dict.json: Vietnamese for the English OpenJLPT meanings, notes and example translations.

Uses your own OpenAI-compatible API (the site has no built-in AI):
  AI_BASE_URL=https://api.openai.com/v1 AI_API_KEY=... AI_MODEL=... python3 scripts/translate_corpus.py [--skip-examples] [--limit 400]
Resumable: strings already in vi-grammar.json or vi-dict.json are skipped.
"""
import argparse, glob, json, os, urllib.request

ROOT = os.path.join(os.path.dirname(__file__), '..', 'static')
OUT = os.path.join(ROOT, 'course', 'vi-dict.json')


def load(path):
    try:
        return json.load(open(path, encoding='utf-8'))
    except FileNotFoundError:
        return {}


def english_strings(examples=True):
    found = {}
    for path in sorted(glob.glob(os.path.join(ROOT, 'openjlpt', '*-n[1-5].json'))):
        for row in json.load(open(path, encoding='utf-8')):
            for text in [*(row.get('meanings') or []), row.get('meaning'), row.get('notes'), *([e.get('en') for e in row.get('examples') or []] if examples else [])]:
                if text:
                    found[text] = True
    return list(found)


def translate(batch, base, key, model):
    prompt = ('Translate each English item from Japanese-learning material into natural Vietnamese. Keep all Japanese text, '
              'kana and symbols unchanged. Reply with only a JSON array of strings, same order and length.\n' + json.dumps(batch, ensure_ascii=False))
    request = urllib.request.Request(base.rstrip('/') + '/chat/completions', data=json.dumps({'model': model, 'messages': [{'role': 'user', 'content': prompt}]}).encode(),
                                     headers={'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json'})
    text = json.load(urllib.request.urlopen(request, timeout=120))['choices'][0]['message']['content'].strip()
    text = text[text.index('['):text.rindex(']') + 1]
    result = json.loads(text)
    if len(result) != len(batch) or not all(isinstance(x, str) and x.strip() for x in result):
        raise ValueError('bad batch')
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--limit', type=int, default=0, help='stop after this many new strings')
    parser.add_argument('--batch', type=int, default=40)
    parser.add_argument('--skip-examples', action='store_true', help='meanings and notes only (about 15,000 strings instead of 29,000)')
    args = parser.parse_args()
    base, key, model = os.environ['AI_BASE_URL'], os.environ['AI_API_KEY'], os.environ['AI_MODEL']
    done = {**load(os.path.join(ROOT, 'course', 'vi-grammar.json')), **load(OUT)}
    todo = [s for s in english_strings(not args.skip_examples) if s not in done]
    if args.limit:
        todo = todo[:args.limit]
    mine = load(OUT)
    for i in range(0, len(todo), args.batch):
        batch = todo[i:i + args.batch]
        try:
            mine.update(zip(batch, translate(batch, base, key, model)))
        except Exception as error:
            print('skip batch', i, error)
            continue
        json.dump(mine, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
        print(f'{min(i + args.batch, len(todo))}/{len(todo)}')


if __name__ == '__main__':
    main()
