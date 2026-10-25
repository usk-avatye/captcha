import unittest
from html.parser import HTMLParser

from render_interactions import path_svg, render


class SvgText(HTMLParser):
    def __init__(self):
        super().__init__()
        self.in_text = False
        self.labels = []

    def handle_starttag(self, tag, attrs):
        if tag == 'text':
            self.in_text = True

    def handle_endtag(self, tag):
        if tag == 'text':
            self.in_text = False

    def handle_data(self, data):
        if self.in_text:
            self.labels.append(data)


class InspectionTest(unittest.TestCase):
    def test_endpoint_times_have_rendered_tooltip_text(self):
        parser = SvgText()
        parser.feed(path_svg([{'x': 0, 'y': 0, 't': 200, 'drag': 1},
                              {'x': 1, 'y': 1, 't': 700, 'drag': 1}]))
        self.assertEqual(parser.labels, ['드래그 1 시작, 200ms', '드래그 1 끝, 700ms'])

    def test_summary_and_separate_drags(self):
        html = render([{'challengeId': 'ch_demo', 'creativeId': 'bmw-m3-v1', 'status': 'passed',
            'revision': 2, 'receivedAt': '2026-10-26T01:00:00Z', 'metrics': {
                'firstInteractionMs': 200, 'solveMs': 700, 'missCount': 1,
                'path': [{'x': .1, 'y': .2, 't': 200, 'drag': 1}, {'x': .3, 'y': .4, 't': 300, 'drag': 1},
                         {'x': .5, 'y': .6, 't': 500, 'drag': 2}],
            }}])
        self.assertIn('0.20초', html)
        self.assertIn('0.70초', html)
        self.assertIn('실패 1회', html)
        self.assertEqual(html.count('<polyline '), 2)
        self.assertIn('100.0,112.5 300.0,225.0', html)

    def test_escaped_text_and_unmeasured_values(self):
        html = render([{'challengeId': '<script>alert(1)</script>', 'creativeId': '" onload="alert(1)',
            'status': 'pending', 'revision': 1, 'receivedAt': '', 'metrics': {
                'firstInteractionMs': None, 'solveMs': None, 'missCount': 0, 'path': None,
            }}])
        self.assertNotIn('<script>', html)
        self.assertIn('&lt;script&gt;', html)
        self.assertIn('경로 표본 미선택', html)
        self.assertIn('미측정', html)
        self.assertIn('수집된 요약이 없습니다', render([]))


if __name__ == '__main__':
    unittest.main()
