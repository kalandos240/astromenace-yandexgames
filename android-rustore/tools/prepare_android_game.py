#!/usr/bin/env python3
from pathlib import Path
import base64
import gzip
import sys

game_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("android-rustore/app/src/main/assets/game")
data_js = game_dir / "gamedata.js"
index_js = game_dir / "index.js"
index_html = game_dir / "index.html"

source = data_js.read_text(encoding="utf-8")

def read_int(marker):
    start = source.index(marker) + len(marker)
    end = source.index(";", start)
    return int(source[start:end].strip())

raw_size = read_int("globalThis.ASTROMENACE_GAMEDATA_RAW_SIZE=")
gzip_size = read_int("globalThis.ASTROMENACE_GAMEDATA_GZIP_SIZE=")

array_marker = "globalThis.ASTROMENACE_GAMEDATA_GZIP_B64_CHUNKS=["
array_start = source.index(array_marker) + len(array_marker)
array_end = source.index("];", array_start)
chunk_source = source[array_start:array_end]

chunks = []
for line in chunk_source.splitlines():
    value = line.strip().rstrip(",")
    if value.startswith('"') and value.endswith('"'):
        chunks.append(value[1:-1])

if not chunks:
    raise SystemExit("No compressed gamedata chunks found")

compressed = b"".join(base64.b64decode(chunk) for chunk in chunks)
if len(compressed) != gzip_size:
    raise SystemExit(f"gzip size mismatch: {len(compressed)} != {gzip_size}")

vfs = gzip.decompress(compressed)
if len(vfs) != raw_size:
    raise SystemExit(f"raw size mismatch: {len(vfs)} != {raw_size}")
if vfs[:8] != b"VFS_v1.6":
    raise SystemExit(f"bad VFS header: {vfs[:8]!r}")

(game_dir / "gamedata.vfs").write_bytes(vfs)
data_js.unlink()

js = index_js.read_text(encoding="utf-8")
start_token = "const decodeEmbeddedGzip=async()=>{"
start = js.find(start_token)
if start < 0:
    raise SystemExit("decodeEmbeddedGzip function not found")

brace = js.find("{", start)
depth = 0
quote = None
escape = False
end = None

for i in range(brace, len(js)):
    ch = js[i]
    if quote is not None:
        if escape:
            escape = False
        elif ch == chr(92):
            escape = True
        elif ch == quote:
            quote = None
        continue

    if ch in ('"', "'", chr(96)):
        quote = ch
    elif ch == "{":
        depth += 1
    elif ch == "}":
        depth -= 1
        if depth == 0:
            end = i + 1
            break

if end is None:
    raise SystemExit("decodeEmbeddedGzip closing brace not found")

replacement = f'''const decodeEmbeddedGzip=async()=>{{
setStatus("Loading game data... 0%");
const response=await fetch("gamedata.vfs",{{cache:"no-store"}});
if(!response.ok)throw new Error("gamedata.vfs HTTP "+response.status);
const buffer=await response.arrayBuffer();
const rawBytes=new Uint8Array(buffer);
if(rawBytes.length!=={raw_size})throw new Error("gamedata.vfs size mismatch ("+rawBytes.length+"/{raw_size})");
const expectedHeader=[0x56,0x46,0x53,0x5f,0x76,0x31,0x2e,0x36];
for(let i=0;i<expectedHeader.length;i++){{if(rawBytes[i]!==expectedHeader[i])throw new Error("gamedata.vfs header is invalid")}}
setStatus("Loading game data... 90%");
try{{FS.unlink("/gamedata.vfs")}}catch(_){{}}
if(typeof FS.createDataFile!=="function")throw new Error("MEMFS createDataFile is unavailable");
FS.createDataFile("/","gamedata.vfs",rawBytes,true,false,true);
const stat=FS.stat("/gamedata.vfs");
if(Number(stat?.size||0)!=={raw_size})throw new Error("installed gamedata size mismatch ("+(stat?.size)+"/{raw_size})");
setStatus("Loading game data... 100%");
console.info("[Android] Direct VFS installed: "+rawBytes.length+" bytes.")
}}'''

js = js[:start] + replacement + js[end:]

protocol_guard = 'if(location.protocol==="file:"){applyLocalLanguageFallback();return}'
if protocol_guard not in js:
    raise SystemExit("Yandex startup protocol guard not found")
js = js.replace(
    protocol_guard,
    'if(location.protocol==="file:"||globalThis.ASTROMENACE_ANDROID){applyLocalLanguageFallback();return}'
)

ready_marker = 'if(loading)loading.classList.add("hidden");'
if ready_marker not in js:
    raise SystemExit("game-ready marker not found")
js = js.replace(
    ready_marker,
    ready_marker + 'try{globalThis.AndroidHost?.gameReady?.()}catch(_){}',
    1
)

fatal_marker = "const showFatal=message=>{"
fatal_at = js.find(fatal_marker)
if fatal_at < 0:
    raise SystemExit("showFatal function not found")
fatal_insert = fatal_at + len(fatal_marker)
js = (
    js[:fatal_insert]
    + 'try{globalThis.AndroidHost?.startupError?.(String(message||"unknown error"))}catch(_){}'
    + js[fatal_insert:]
)
index_js.write_text(js, encoding="utf-8")

html = index_html.read_text(encoding="utf-8")
html = html.replace('  <script src="gamedata.js" charset="utf-8"></script>' + chr(10), "")
html = html.replace(
    '<script src="index.js" charset="utf-8"></script>',
    '<script>globalThis.ASTROMENACE_ANDROID=true;</script>' + chr(10)
    + '  <script src="index.js" charset="utf-8"></script>'
)
index_html.write_text(html, encoding="utf-8")

print(f"Android game prepared: VFS={raw_size} bytes; removed Base64 payload={gzip_size} compressed bytes")
