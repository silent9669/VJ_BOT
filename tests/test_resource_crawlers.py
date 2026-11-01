"""Publisher parsing rejects partial indexes instead of erasing a usable catalog."""
import json
from pathlib import Path
from unittest.mock import patch

import pytest
from scripts import crawl_jlpt_resources as jlpt
from scripts import crawl_erin_resources as erin


def jlpt_html():
    catalog = json.loads(Path('static/course/jlpt-resources.json').read_text())
    return '\n'.join(f'<a href="{row["url"]}">resource</a>' for row in catalog['resources'])


def test_jlpt_deduplicates_and_rejects_foreign_links():
    html = jlpt_html()
    rows = jlpt.parse_resources(html + html + '<a href="https://example.org/sample2018/pdf/N5V.pdf">wrong</a>')
    assert len(rows) == 111
    assert len({row['id'] for row in rows}) == 111
    assert {row['year'] for row in rows} == {'2012', '2018'}


def test_partial_jlpt_crawl_leaves_previous_output(tmp_path):
    output = tmp_path / 'catalog.json'
    output.write_text('previous valid catalog')
    incomplete = jlpt_html().replace('N5answer.pdf', 'missing.pdf').encode()
    with patch.object(jlpt, 'OUT', output), patch.object(jlpt.urllib.request, 'urlopen') as request:
        request.return_value.__enter__.return_value.read.return_value = incomplete
        with pytest.raises(ValueError, match='Incomplete'):
            jlpt.crawl()
    assert output.read_text() == 'previous valid catalog'


def test_erin_requires_all_expanded_activities():
    catalog = json.loads(Path('static/course/erin-resources.json').read_text())
    first = catalog['lessons'][0]
    html = '<h2 class="page-title-bar"><span class="text">Greeting &amp; introductions</span></h2>'
    html += ''.join(f'<a href="{row["url"].removeprefix(erin.BASE)}">activity</a>' for row in first['resources'])
    parsed = erin.parse_lesson(html, 1)
    assert parsed['title'] == 'Greeting & introductions'
    assert len(parsed['resources']) == 9
    with pytest.raises(ValueError, match='Missing resource'):
        erin.parse_lesson(html.replace('/onomatopoeia/', '/missing/'), 1)
