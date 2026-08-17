#!/usr/bin/env python3
from pathlib import Path
import argparse, re, shutil
BRIDGE='<script src="https://bridge.playgama.com/v1/stable/playgama-bridge.js"></script>'
ADAPTER='<script src="playgama-yandex-compat.js"></script>'
NOTICE='''Playgama integration\n====================\nActive SDK: Playgama Bridge JS Core v1 stable\nhttps://bridge.playgama.com/v1/stable/playgama-bridge.js\nThe existing game-side Yandex-style calls are mapped to Playgama Bridge by\nplaygama-yandex-compat.js (language, lifecycle, ads, pause/resume and storage).\nThe Playgama package does not load /sdk.js.\n'''
def patch_html(html):
    if 'bridge.playgama.com/v1/stable/playgama-bridge.js' in html:return html
    direct=re.compile(r'<script\s+src=(?:["\']?/sdk\.js["\']?|/sdk\.js)\s*></script>',re.I)
    if direct.search(html):return direct.sub(BRIDGE+ADAPTER,html,count=1)
    boot='<script src="yandex-bootstrap.js"></script>'
    if boot in html:return html.replace(boot,BRIDGE+ADAPTER+boot,1)
    gamedata='<script src="gamedata.js" charset="utf-8"></script>'
    if gamedata in html:return html.replace(gamedata,BRIDGE+'\n  '+ADAPTER+'\n  '+gamedata,1)
    raise SystemExit('No supported Playgama SDK insertion point')
def main():
    ap=argparse.ArgumentParser();ap.add_argument('dist',type=Path);ap.add_argument('--adapter',type=Path,required=True);ap.add_argument('--config',type=Path,required=True);a=ap.parse_args()
    dist=a.dist.resolve();index=dist/'index.html'
    if not index.is_file():raise SystemExit('index.html must be in package root')
    html=patch_html(index.read_text(encoding='utf-8'))
    if re.search(r'<script\s+src=(?:["\']?/sdk\.js["\']?|/sdk\.js)',html,re.I):raise SystemExit('Direct /sdk.js remains')
    if BRIDGE not in html or ADAPTER not in html:raise SystemExit('Playgama bootstrap missing')
    index.write_text(html,encoding='utf-8');shutil.copy2(a.adapter,dist/'playgama-yandex-compat.js');shutil.copy2(a.config,dist/'playgama-bridge-config.json');(dist/'PLAYGAMA-INTEGRATION.txt').write_text(NOTICE,encoding='utf-8')
    bad=[];total=0
    for p in dist.rglob('*'):
        if not p.is_file():continue
        rel=p.relative_to(dist).as_posix();total+=p.stat().st_size
        if ' ' in rel or any(ord(c)>127 for c in rel):bad.append(rel)
    if bad:raise SystemExit(f'Invalid archive paths: {bad}')
    if total>=300_000_000:raise SystemExit(f'Playgama package exceeds 300 MB: {total}')
    print('Playgama package ready',total)
if __name__=='__main__':main()
