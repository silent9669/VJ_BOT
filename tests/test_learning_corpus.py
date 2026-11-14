"""Corpus admission preserves source identity and never fabricates blocked coverage."""
import json

import pytest

from scripts import build_learning_corpus as corpus


@pytest.fixture
def manifest(tmp_path):
    text = 'Trợ từ は nêu chủ đề. 私は学生です。\n\nVí dụ có ngữ cảnh. ' * 35
    content = tmp_path / 'lesson.md'
    content.write_text(text, encoding='utf-8')
    records, outcomes = [], []
    for ident, (_, name, host) in corpus.PUBLISHERS.items():
        if ident == 'nhk':
            continue
        records.append({
            'source_id': ident, 'source_name': name, 'url': f'https://{host}/lesson',
            'title': 'Trợ từ は', 'capture_path': str(content), 'content_path': str(content),
            'content_format': 'markdown', 'coverage': 'lesson_body', 'source_level': None,
        })
        outcomes.append({'source_id': ident, 'status': 'acquired', 'reason': 'Bounded synthetic test capture'})
    path = tmp_path / 'manifest.json'
    path.write_text(json.dumps({'records': records, 'outcomes': outcomes}), encoding='utf-8')
    return path


def test_short_ids_and_source_headers_reconstruct_the_same_original_passages(manifest):
    first = corpus.build_corpus([manifest])
    second = corpus.build_corpus([manifest])
    assert first == second
    assert first['authorization']['publisher_permission_independently_verified'] is False
    assert len(first['coverage']) == 7
    assert first['coverage'][-2]['source_id'] == 'nhk'
    assert first['coverage'][-2]['documents'] == 0
    for document in first['documents']:
        chunks = [chunk for chunk in first['chunks'] if chunk['document_id'] == document['id']]
        assert all(chunk['url'] == document['url'] for chunk in chunks)
        assert all(chunk['header'].startswith('Nguồn: ') and chunk['id'] in chunk['header'] for chunk in chunks)
        assert all(chunk['review_status'] == 'unreviewed' and len(chunk['text']) <= 1400 for chunk in chunks)
        assert '私は学生です。' in '\n'.join(chunk['text'] for chunk in chunks)


@pytest.mark.parametrize('problem', ['missing_source', 'fake_acquisition', 'foreign_origin', 'nhk_body', 'index_only'])
def test_bad_acquisition_cannot_replace_existing_published_corpus(manifest, tmp_path, problem):
    data = json.loads(manifest.read_text(encoding='utf-8'))
    if problem == 'missing_source':
        data['outcomes'].pop()
        data['records'].pop()
    elif problem == 'fake_acquisition':
        data['records'].pop()
    elif problem == 'foreign_origin':
        data['records'][0]['url'] = 'https://attacker.example/lesson'
    elif problem == 'nhk_body':
        data['records'][0]['source_id'] = 'nhk'
    else:
        data['records'][0]['coverage'] = 'index_read'
    manifest.write_text(json.dumps(data), encoding='utf-8')
    output = tmp_path / 'published.json'
    output.write_bytes(b'previous corpus')
    with pytest.raises(ValueError):
        corpus.publish([manifest], output)
    assert output.read_bytes() == b'previous corpus'


def test_passages_keep_literal_source_content_not_generated_replacements():
    text = '説明：は means topic.\n\n私は学生です。\n\nBản nguồn giữ nguyên.'
    assert '\n\n'.join(corpus.passages(text)) == text


def test_binary_capture_receipt_uses_actual_bytes_without_entering_the_corpus(tmp_path):
    path = tmp_path / 'lesson.pdf'
    raw = b'%PDF retained source bytes'
    path.write_bytes(raw)
    digest, size = corpus.capture_receipt(path)
    import hashlib
    assert digest == hashlib.sha256(raw).hexdigest()
    assert size == len(raw)


def test_oversized_vietnamese_paragraph_keeps_words_and_lossless_offsets():
    text = ('Ở Nhật Bản người ta chào hỏi và nói cám ơn. ' * 70) + 'すみません。'
    chunks = corpus.passages(text)
    assert ''.join(chunks) == text
    offset = 0
    for chunk in chunks:
        assert chunk == text[offset:offset + len(chunk)]
        offset += len(chunk)
        assert len(chunk) <= 1400
        if offset < len(text):
            assert text[offset - 1].isspace() or text[offset - 1] in '。！？.!?'
