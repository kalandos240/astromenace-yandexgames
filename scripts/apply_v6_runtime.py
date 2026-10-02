from pathlib import Path
import json
p = Path('dist/index.js')
s = p.read_text()
s = Path('web/v6-host-pre.js').read_text() + s[s.index('var programArgs='):]
patches = json.loads(Path('web/v6-runtime-patches.json').read_text())
for start, (end, replacement) in patches.items():
    if start == 'const astroGLCapabilities=':
        start = 'var _emscripten_glActiveTexture='
    a = s.index(start)
    b = s.index(end, a)
    s = s[:a] + replacement + s[b:]
p.write_text(s)
