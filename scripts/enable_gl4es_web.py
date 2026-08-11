#!/usr/bin/env python3
"""Prepare the AstroMenace source tree for the gl4es WebAssembly renderer.

The imported Emscripten branch originally used gl4es. Some earlier porting
experiments removed its explicit initialization while testing Emscripten's
legacy GL layer. The Yandex build uses gl4es because AstroMenace relies on a
wider OpenGL 1.x/2.x compatibility surface.

The browser canvas already occupies the Yandex Games iframe, so the WebAssembly
build must not ask SDL for native desktop fullscreen. Browser fullscreen APIs
can require a user gesture and requesting them during startup is unsafe. The
CI-only patch therefore treats AstroMenace's fullscreen preference as a normal
SDL/WebGL canvas window while preserving the requested render dimensions.

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

web_window = (
    "#ifdef __EMSCRIPTEN__\n"
    "    // The canvas already fills the Yandex Games iframe. Avoid requesting\n"
    "    // browser/desktop fullscreen during SDL window creation; fullscreen\n"
    "    // APIs may require an explicit user gesture in browsers.\n"
    "    Fullscreen = false;\n"
    "#endif\n\n"
)
if "The canvas already fills the Yandex Games iframe" not in text:
    marker = "    Uint32 Flags{SDL_WINDOW_OPENGL};\n"
    if marker not in text:
        raise SystemExit("Could not find SDL window flag insertion point")
    text = text.replace(marker, web_window + marker, 1)

init = "#ifdef __EMSCRIPTEN__\n    initialize_gl4es();\n#endif\n\n"
if "initialize_gl4es();" not in text:
    marker = "    if (SDL_GL_SetSwapInterval(VSync) == -1) {\n"
    if marker not in text:
        raise SystemExit("Could not find gl4es initialization insertion point")
    text = text.replace(marker, init + marker, 1)

path.write_text(text, encoding="utf-8")
print("Enabled gl4es initialization and browser-safe SDL window creation.")
