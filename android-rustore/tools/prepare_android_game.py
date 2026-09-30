#!/usr/bin/env python3
from pathlib import Path
import base64
import gzip
import struct
import sys

game_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("android-rustore/app/src/main/assets/game")
data_js = game_dir / "gamedata.js"
index_js = game_dir / "index.js"
index_html = game_dir / "index.html"
css_file = game_dir / "astromenace.css"

source = data_js.read_text(encoding="utf-8")


def read_int(marker):
    start = source.index(marker) + len(marker)
    end = source.index(";", start)
    return int(source[start:end].strip())


def vfs_entries(data):
    if data[:8] != b"VFS_v1.6":
        raise SystemExit(f"bad VFS header: {data[:8]!r}")

    table_offset = struct.unpack_from("<I", data, 12)[0]
    if table_offset < 16 or table_offset > len(data):
        raise SystemExit("invalid VFS table offset")

    entries = {}
    pos = table_offset
    while pos < len(data):
        if pos + 2 > len(data):
            raise SystemExit("truncated VFS table")
        name_size = struct.unpack_from("<H", data, pos)[0]
        pos += 2
        if name_size <= 0 or pos + name_size + 8 > len(data):
            raise SystemExit("invalid VFS entry")
        name = bytes(data[pos:pos + name_size]).decode("utf-8")
        pos += name_size
        offset, size = struct.unpack_from("<II", data, pos)
        pos += 8
        if offset + size > table_offset:
            raise SystemExit(f"invalid VFS entry range for {name}")
        entries[name] = (offset, size)
    return entries


def make_rle_tga_fully_transparent(data, offset, size, name):
    blob = memoryview(data)[offset:offset + size]
    if len(blob) < 18:
        raise SystemExit(f"{name}: truncated TGA")

    id_length = blob[0]
    color_map_type = blob[1]
    image_type = blob[2]
    width = int.from_bytes(blob[12:14], "little")
    height = int.from_bytes(blob[14:16], "little")
    bpp = blob[16]

    if color_map_type != 0 or image_type != 10 or bpp != 32:
        raise SystemExit(
            f"{name}: expected RLE 32-bit true-color TGA, got "
            f"cmap={color_map_type} type={image_type} bpp={bpp}"
        )

    pos = 18 + id_length
    pixels_left = width * height

    while pixels_left > 0:
        if pos >= len(blob):
            raise SystemExit(f"{name}: truncated RLE packet")
        packet = blob[pos]
        pos += 1
        count = (packet & 0x7F) + 1

        if packet & 0x80:
            if pos + 4 > len(blob):
                raise SystemExit(f"{name}: truncated RLE pixel")
            blob[pos + 3] = 0
            pos += 4
        else:
            byte_count = count * 4
            if pos + byte_count > len(blob):
                raise SystemExit(f"{name}: truncated raw TGA packet")
            for pixel in range(count):
                blob[pos + pixel * 4 + 3] = 0
            pos += byte_count

        pixels_left -= count
        if pixels_left < 0:
            raise SystemExit(f"{name}: invalid RLE pixel count")

    print(f"Android cursor asset hidden: {name} ({width}x{height})")


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

vfs = bytearray(gzip.decompress(compressed))
if len(vfs) != raw_size:
    raise SystemExit(f"raw size mismatch: {len(vfs)} != {raw_size}")

entries = vfs_entries(vfs)
for cursor_name in ("menu/cursor.tga", "menu/cursor_shadow.tga"):
    if cursor_name not in entries:
        raise SystemExit(f"missing cursor asset in VFS: {cursor_name}")
    cursor_offset, cursor_size = entries[cursor_name]
    make_rle_tga_fully_transparent(vfs, cursor_offset, cursor_size, cursor_name)

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

mobile_input_script = r'''
<script>
globalThis.ASTROMENACE_ANDROID=true;
(() => {
  "use strict";

  const canvas = document.getElementById("canvas");
  if (!canvas) return;

  let menuVisibleSent = false;
  const reportMenuVisible = () => {
    const loading = document.getElementById("loading");
    if (menuVisibleSent || !loading || !loading.classList.contains("hidden")) return;
    menuVisibleSent = true;
    try { globalThis.AndroidHost?.menuVisible?.(); } catch (_) {}
    console.info("[Android] menu visible");
  };

  const loading = document.getElementById("loading");
  if (loading) {
    new MutationObserver(reportMenuVisible).observe(loading, {
      attributes: true,
      attributeFilter: ["class"]
    });
  }
  setInterval(reportMenuVisible, 250);

  const showKeyboard = () => {
    try { globalThis.AndroidHost?.showKeyboard?.(); } catch (_) {}
    console.info("[AndroidInput] native profile keyboard requested");
  };

  globalThis.__astroMobileKeyboard = {
    show: showKeyboard,
    hide: () => {
      try { globalThis.AndroidHost?.hideKeyboard?.(); } catch (_) {}
    }
  };

  let gameplayBridgeInstalled = false;
  const installGameplayBridge = () => {
    if (gameplayBridgeInstalled || !globalThis.Module) return;
    const start = globalThis.Module.yandexGameplayStart;
    const stop = globalThis.Module.yandexGameplayStop;
    const levelComplete = globalThis.Module.yandexLevelComplete;
    if (
      typeof start !== "function" ||
      typeof stop !== "function" ||
      typeof levelComplete !== "function"
    ) return;

    globalThis.Module.yandexGameplayStart = function(...args) {
      try { globalThis.AndroidHost?.gameplayControls?.(true); } catch (_) {}
      return start.apply(this, args);
    };
    globalThis.Module.yandexGameplayStop = function(...args) {
      try { globalThis.AndroidHost?.gameplayControls?.(false); } catch (_) {}
      return stop.apply(this, args);
    };
    globalThis.Module.yandexLevelComplete = async function(...args) {
      const result = await levelComplete.apply(this, args);
      try { globalThis.AndroidHost?.requestInterstitial?.("level-complete"); } catch (_) {}
      return result;
    };
    gameplayBridgeInstalled = true;
    try { globalThis.AndroidHost?.gameplayControls?.(false); } catch (_) {}
    console.info("[Android] gameplay/level-complete bridge installed");
  };
  setInterval(installGameplayBridge, 100);
})();
</script>
'''
html = index_html.read_text(encoding="utf-8")
html = html.replace('  <script src="gamedata.js" charset="utf-8"></script>' + chr(10), "")
html = html.replace(
    '<script src="index.js" charset="utf-8"></script>',
    mobile_input_script + chr(10) + '  <script src="index.js" charset="utf-8"></script>'
)
index_html.write_text(html, encoding="utf-8")

css = css_file.read_text(encoding="utf-8")
css += r'''

/* Android/RuStore: occupy the complete physical display. The browser build
   intentionally letterboxes to 16:9, but the mobile app must use the phone
   or tablet screen edge-to-edge. */
html,
body {
  position: fixed !important;
  inset: 0 !important;
  width: 100vw !important;
  height: 100vh !important;
  min-width: 100vw !important;
  min-height: 100vh !important;
}

body {
  display: block !important;
}

html *,
body * {
  cursor: none !important;
}

#canvas {
  position: fixed !important;
  inset: 0 !important;
  width: 100vw !important;
  height: 100vh !important;
  max-width: none !important;
  max-height: none !important;
  margin: 0 !important;
  cursor: none !important;
  image-rendering: auto !important;
  backface-visibility: hidden;
  transform: translateZ(0);
}
'''
css_file.write_text(css, encoding="utf-8")

print(
    f"Android game prepared: VFS={raw_size} bytes; "
    f"removed Base64 payload={gzip_size} compressed bytes; "
    "cursor hidden; high-quality full-screen compositing and gated mobile keyboard bridge installed"
)
