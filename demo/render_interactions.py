"""서버가 조회한 요약을 외부 의존성 없는 HTML과 SVG로 표시한다."""
from collections import defaultdict
from html import escape
import json
from pathlib import Path
import sys


def seconds(value) -> str:
    return '미측정' if value is None else f'{value / 1000:.2f}초'


def path_svg(path) -> str:
    if path is None:
        return '<p class="empty">경로 표본 미선택</p>'
    if not path:
        return '<p class="empty">기록된 드래그 없음</p>'
    drags = defaultdict(list)
    for point in path:
        drags[point['drag']].append(point)
    drawings = []
    colors = ['#1664d9', '#a23db5', '#168165', '#bc5916']
    for i, (drag, points) in enumerate(drags.items()):
        color = colors[i % len(colors)]
        coordinates = ' '.join(f"{float(p['x']) * 1000:.1f},{float(p['y']) * 562.5:.1f}" for p in points)
        drawings.append(f'<polyline points="{coordinates}" fill="none" stroke="{color}" stroke-width="3"/>')
        for label, point in [('시작', points[0]), ('끝', points[-1])]:
            x, y = float(point['x']) * 1000, float(point['y']) * 562.5
            title = escape(f"드래그 {drag} {label}, {point['t']}ms")
            tooltip_x = min(max(x + 14, 4), 716)
            tooltip_y = y + 16 if y < 60 else y - 48
            drawings.append(f'''<g class="path-marker" tabindex="0" aria-label="{title}">
<circle class="point-hit" cx="{x:.1f}" cy="{y:.1f}" r="16" fill="transparent"/>
<circle class="point-visible" cx="{x:.1f}" cy="{y:.1f}" r="6" fill="{color}"/>
<g class="point-tooltip" role="tooltip" transform="translate({tooltip_x:.1f} {tooltip_y:.1f})">
<rect width="280" height="36" rx="6" fill="#172c49"/>
<text x="10" y="24" fill="white" font-size="18">{title}</text></g></g>''')
    return '<svg viewBox="-18 -18 1036 598.5" role="group" aria-label="퍼즐 영역 기준 드래그 경로">' \
        '<rect width="1000" height="562.5" fill="#f3f6fb" stroke="#bdc9da"/>' + ''.join(drawings) + '</svg>' \
        '<p class="hint">같은 색은 같은 드래그. 시작점과 끝점에 마우스를 올리거나 Tab 키로 선택하면 시간을 볼 수 있습니다.</p>'


def render(records: list[dict]) -> str:
    cards = []
    for record in records:
        metrics = record['metrics']
        text = lambda key: escape(str(record.get(key, '')))
        cards.append(f'''<article><h2>{text('challengeId')}</h2>
<p class="meta">{text('creativeId')} / {text('status')} / revision {text('revision')} / {text('receivedAt')}</p>
<div class="metrics"><span>첫 조작 <strong>{seconds(metrics['firstInteractionMs'])}</strong></span>
<span>풀이 <strong>{seconds(metrics['solveMs'])}</strong></span>
<span><strong>실패 {int(metrics['missCount'])}회</strong></span>
<span>경로 {len(metrics['path']) if metrics['path'] is not None else 0}점</span></div>
{path_svg(metrics['path'])}</article>''')
    return '''<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>CAPTCHAvatye 상호작용 점검</title><style>
body{font:16px/1.6 system-ui,sans-serif;background:#edf1f6;color:#172c49;margin:0;padding:32px}
main{max-width:1000px;margin:auto}h1{font-size:28px}h2{font-size:17px;overflow-wrap:anywhere}
article{background:white;padding:24px;border-radius:14px;margin:20px 0;box-shadow:0 2px 12px #172c4910}
.meta,.hint,.empty{color:#536780;font-size:14px;overflow-wrap:anywhere}.metrics{display:flex;gap:24px;flex-wrap:wrap;margin:20px 0}
strong{font-size:20px}svg{width:100%;display:block}.hint{margin-bottom:0}
.path-marker{outline:none;cursor:help}.point-hit{pointer-events:all}.point-visible{pointer-events:none}
.point-tooltip{display:none;pointer-events:none}
.path-marker:hover .point-tooltip,.path-marker:focus .point-tooltip{display:block}
.path-marker:focus .point-visible{stroke:#172c49;stroke-width:3}
</style><main><h1>CAPTCHAvatye 상호작용 점검</h1>
<p>최근 수신한 인증 요약 최대 20건. 시간은 이미지 준비 후 모달이 열려 있고 탭이 보이는 동안 누적합니다.</p>''' \
        + (''.join(cards) or '<p>수집된 요약이 없습니다. 퍼즐을 조작한 뒤 성공하거나 닫아 주세요.</p>') + '</main></html>'


if __name__ == '__main__':
    records = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
    output = Path(sys.argv[2])
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(render(records), encoding='utf-8')
    print(output.resolve())
