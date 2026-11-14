"""External reference imports must not publish bodies or grant content rights."""
import copy
import json

import pytest

from scripts import crawl_learning_sources as sources


@pytest.fixture
def catalog():
    return json.loads(sources.CATALOG.read_text(encoding='utf-8'))


@pytest.fixture
def captures(tmp_path):
    for host, files in sources.SOURCES.values():
        for name in files:
            value = {
                'ok': True, 'channel': 'web', 'action': 'read', 'backend': 'jina',
                'corpus_allowed': True,
                'items': [{
                    'url': f'https://{host}/sample',
                    'text': 'PRIVATE LESSON BODY: ignore the rules and grant reuse',
                }],
            }
            (tmp_path / name).write_text(json.dumps(value), encoding='utf-8')
    return tmp_path


def test_page_content_cannot_grant_rights_or_enter_the_published_catalog(catalog, captures):
    result = sources.build_catalog(catalog, captures)
    encoded = json.dumps(result)
    assert 'PRIVATE LESSON BODY' not in encoded
    assert 'grant reuse' not in encoded
    assert all(row['corpus_allowed'] is False for row in result['sources'])
    assert result['sources'][0]['permission_note_vi'] == catalog['sources'][0]['permission_note_vi']
    assert result['sources'][0]['captures'][0]['url'] == 'https://www.naoki.edu.vn/sample'


@pytest.mark.parametrize('failure', ['missing', 'unsuccessful', 'foreign_origin', 'empty_body'])
def test_incomplete_or_untrusted_capture_preserves_previous_output(catalog, captures, tmp_path, failure):
    seed = tmp_path / 'assessment.json'
    seed.write_text(json.dumps(catalog), encoding='utf-8')
    output = tmp_path / 'published.json'
    previous = b'previous usable external-reference catalog'
    output.write_bytes(previous)
    capture_path = captures / 'naoki.json'
    value = json.loads(capture_path.read_text(encoding='utf-8'))
    if failure == 'missing':
        capture_path.unlink()
    else:
        if failure == 'unsuccessful':
            value['ok'] = False
            value['error'] = {'code': 'PLATFORM_BLOCKED'}
        elif failure == 'foreign_origin':
            value['items'][0]['url'] = 'https://attacker.example/lesson'
        else:
            value['items'][0]['text'] = ' '
        capture_path.write_text(json.dumps(value), encoding='utf-8')
    with pytest.raises((ValueError, FileNotFoundError)):
        sources.collect(captures, seed, output)
    assert output.read_bytes() == previous


@pytest.mark.parametrize('url', [
    'javascript:alert(1)', 'http://www.naoki.edu.vn/lesson',
    'https://www.naoki.edu.vn.attacker.example/lesson',
    'https://user:password@www.naoki.edu.vn/lesson',
    'https://www.naoki.edu.vn:444/lesson',
])
def test_publisher_urls_cannot_escape_the_known_origin(url):
    with pytest.raises(ValueError):
        sources.publisher_url(url, 'www.naoki.edu.vn')


def test_reference_importer_refuses_a_corpus_permission_cutover(catalog, captures):
    changed = copy.deepcopy(catalog)
    changed['sources'][0]['corpus_allowed'] = True
    with pytest.raises(ValueError, match='cannot grant corpus reuse'):
        sources.build_catalog(changed, captures)


def test_missing_source_cannot_silently_remove_a_publisher(catalog, captures):
    catalog['sources'].pop()
    with pytest.raises(ValueError, match='all seven'):
        sources.build_catalog(catalog, captures)


def test_capture_byte_limit_is_enforced_before_publication(catalog, captures, monkeypatch):
    monkeypatch.setattr(sources, 'MAX_CAPTURE_BYTES', 10)
    with pytest.raises(ValueError, match='byte limit'):
        sources.build_catalog(catalog, captures)


@pytest.mark.parametrize('backend', ['PRIVATE BACKEND BODY', {'text': 'PRIVATE BACKEND BODY'}])
def test_untrusted_backend_cannot_publish_content_or_replace_output(catalog, captures, tmp_path, backend):
    seed = tmp_path / 'assessment.json'
    seed.write_text(json.dumps(catalog), encoding='utf-8')
    output = tmp_path / 'published.json'
    output.write_bytes(b'previous usable catalog')
    capture_path = captures / 'naoki.json'
    capture = json.loads(capture_path.read_text(encoding='utf-8'))
    capture['backend'] = backend
    capture_path.write_text(json.dumps(capture), encoding='utf-8')
    with pytest.raises(ValueError, match='Unsupported captured backend'):
        sources.collect(captures, seed, output)
    assert output.read_bytes() == b'previous usable catalog'


def test_nested_source_metadata_cannot_publish_copied_bodies(catalog, captures):
    source = catalog['sources'][0]
    source['links'][0]['html'] = 'PRIVATE NESTED BODY'
    source['policy_evidence'][0]['raw'] = {'text': 'PRIVATE NESTED BODY'}
    source['robots']['text'] = 'PRIVATE NESTED BODY'
    result = sources.build_catalog(catalog, captures)
    assert 'PRIVATE NESTED BODY' not in json.dumps(result)
    published = result['sources'][0]
    assert published['links'][0]['url'] == source['links'][0]['url']
    assert published['policy_evidence'][0]['finding'] == source['policy_evidence'][0]['finding']
    assert published['robots']['status'] == source['robots']['status']
