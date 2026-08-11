#!/usr/bin/env python3
"""Prepare the AstroMenace source tree for the gl4es WebAssembly renderer.

The imported Emscripten branch originally used gl4es. Some earlier porting
experiments removed its explicit initialization while testing Emscripten's
legacy GL layer. The Yandex build now uses gl4es again because AstroMenace
relies on a wider OpenGL 1.x/2.x compatibility surface.

This script is intentionally idempotent and is run only in CI's checked-out
worktree; native source behaviour remains unchanged.
"""

from pathlib import Path

path = Path("src/core/graphics/gl_main.cpp")
text = path.read_text(encoding="utf-8")

include = "#ifdef __EMSCRIPTEN__\n#include <gl4esinit.h>\n#endif\n\n"
if "#include <gl4esinit.h>" not in text:
    marker = "#include <algorithm>\n"
    if marker not in text:
        raise SystemExit("Could not find gl_main.cpp include insertion point")
    text = text.replace(marker, include + marker, 1)

init = "#ifdef __EMSCRIPTEN__\n    initialize_gl4es();\n#endif\n\n"
if "initialize_gl4es();" not in text:
    marker = "    if (SDL_GL_SetSwapInterval(VSync) == -1) {\n"
    if marker not in text:
        raise SystemExit("Could not find gl4es initialization insertion point")
    text = text.replace(marker, init + marker, 1)

path.write_text(text, encoding="utf-8")
print("Enabled explicit gl4es initialization for the WebAssembly build.")
