#!/usr/bin/env python3
"""Convert the pinned AstroMenace browser build into a Playgama package."""
from pathlib import Path
import argparse
import re
import shutil

BRIDGE_URL = "https://bridge.playgama.com/v2/stable/playgama-bridge.js"
BRIDGE = f'<script src="{BRIDGE_URL}"></script>'
ADAPTER = '<script src="playgama-yandex-compat.js"></script>'
VIEWPORT_MARKER = 'Playgama full-viewport space background v1'
VIEWPORT_CSS = r'''

/* Playgama full-viewport space background v1
   Presentation only: AstroMenace keeps its original 16:9 canvas and runtime.
   Square/wide/tall QA containers show a continuous space backdrop instead of
   black letterbox bars, while the complete game canvas remains visible. */
html,
body {
  background-color: #050914 !important;
  background-image:
    radial-gradient(ellipse at 20% 18%, rgba(48, 103, 164, .55) 0%, rgba(23, 53, 96, .30) 24%, transparent 55%),
    radial-gradient(ellipse at 83% 76%, rgba(89, 55, 147, .45) 0%, rgba(45, 28, 83, .25) 25%, transparent 55%),
    radial-gradient(circle at 12% 20%, rgba(255,255,255,.95) 0 1px, transparent 1.6px),
    radial-gradient(circle at 71% 31%, rgba(190,225,255,.90) 0 1px, transparent 1.7px),
    radial-gradient(circle at 38% 77%, rgba(255,255,255,.80) 0 1px, transparent 1.5px),
    radial-gradient(circle at 91% 14%, rgba(220,235,255,.85) 0 1px, transparent 1.6px),
    linear-gradient(180deg, #071326 0%, #050914 48%, #090617 100%) !important;
  background-repeat: no-repeat, no-repeat, repeat, repeat, repeat, repeat, no-repeat !important;
  background-size: cover, cover, 137px 137px, 181px 181px, 223px 223px, 271px 271px, cover !important;
  background-position: center, center, 0 0, 37px 59px, 83px 19px, 17px 101px, center !important;
}

#loading {
  background-color: #050914 !important;
  background-image:
    radial-gradient(ellipse at 50% 38%, rgba(45, 94, 151, .38) 0%, transparent 58%),
    radial-gradient(circle at 17% 23%, rgba(255,255,255,.85) 0 1px, transparent 1.6px),
    radial-gradient(circle at 76% 67%, rgba(205,230,255,.80) 0 1px, transparent 1.6px),
    linear-gradient(180deg, #071326 0%, #050914 60%, #090617 100%) !important;
  background-repeat: no-repeat, repeat, repeat, no-repeat !important;
  background-size: cover, 157px 157px, 211px 211px, cover !important;
}
'''

NOTICE = f"""Playgama integration
====================

Active SDK: Playgama Bridge JS Core v2 stable
{BRIDGE_URL}

AstroMenace keeps its already-tested Yandex-style game calls behind
playgama-yandex-compat.js. The facade maps language, lifecycle, interstitial ads,
pause/resume, audio mute and cloud save data to Playgama Bridge v2.
Rewarded ads are intentionally disabled because AstroMenace has no rewarded-ad
mechanic. The Playgama package never loads /sdk.js.

Bridge configuration: playgama-bridge-config.json
Viewport: original 16:9 game canvas remains fully visible and centered; only the
unused surrounding area receives a responsive space background.
"""


def patch_html(html: str) -> str:
    html = re.sub(
        r'<script\s+src=["\']https://bridge\.playgama\.com/v1/(?:stable|latest)/playgama-bridge\.js["\']\s*></script>',
        BRIDGE,
        html,
        flags=re.I,
    )
    if BRIDGE_URL in html and 'playgama-yandex-compat.js' in html:
        return html

    direct_sdk = re.compile(r'<script\s+src=(?:["\']?/sdk\.js["\']?|/sdk\.js)\s*></script>', re.I)
    if direct_sdk.search(html):
        return direct_sdk.sub(BRIDGE + ADAPTER, html, count=1)

    yandex_bootstrap = '<script src="yandex-bootstrap.js"></script>'
    if yandex_bootstrap in html:
        return html.replace(yandex_bootstrap, BRIDGE + ADAPTER + yandex_bootstrap, 1)

    gamedata = '<script src="gamedata.js" charset="utf-8"></script>'
    if gamedata in html:
        return html.replace(gamedata, BRIDGE + '\n  ' + ADAPTER + '\n  ' + gamedata, 1)

    raise SystemExit('No supported Playgama SDK insertion point')


def patch_viewport_css(dist: Path) -> None:
    css_path = dist / 'astromenace.css'
    if not css_path.is_file():
        raise SystemExit('astromenace.css is missing')
    css = css_path.read_text(encoding='utf-8')
    css = re.sub(
        r'\n/\* Playgama full-viewport space background(?: v\d+)?[\s\S]*\Z',
        '',
        css,
        count=1,
    )
    css += VIEWPORT_CSS
    css_path.write_text(css, encoding='utf-8')


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('dist', type=Path)
    ap.add_argument('--adapter', type=Path, required=True)
    ap.add_argument('--config', type=Path, required=True)
    args = ap.parse_args()

    dist = args.dist.resolve()
    index = dist / 'index.html'
    if not index.is_file():
        raise SystemExit('index.html must be in package root')

    html = patch_html(index.read_text(encoding='utf-8'))
    if re.search(r'<script\s+src=(?:["\']?/sdk\.js["\']?|/sdk\.js)', html, re.I):
        raise SystemExit('Direct /sdk.js remains')
    if 'bridge.playgama.com/v1/' in html:
        raise SystemExit('Legacy Playgama Bridge v1 reference remains')
    if BRIDGE not in html or ADAPTER not in html:
        raise SystemExit('Playgama Bridge v2 bootstrap missing')
    index.write_text(html, encoding='utf-8')

    patch_viewport_css(dist)
    shutil.copy2(args.adapter, dist / 'playgama-yandex-compat.js')
    shutil.copy2(args.config, dist / 'playgama-bridge-config.json')
    (dist / 'PLAYGAMA-INTEGRATION.txt').write_text(NOTICE, encoding='utf-8')

    bad = []
    total = 0
    for path in dist.rglob('*'):
        if not path.is_file():
            continue
        rel = path.relative_to(dist).as_posix()
        total += path.stat().st_size
        if ' ' in rel or any(ord(ch) > 127 for ch in rel):
            bad.append(rel)
    if bad:
        raise SystemExit(f'Invalid archive paths: {bad}')
    if total >= 300_000_000:
        raise SystemExit(f'Playgama package exceeds 300 MB: {total}')

    print(f'Playgama Bridge v2 package ready: {dist}')
    print(f'Unpacked bytes: {total}')


if __name__ == '__main__':
    main()
