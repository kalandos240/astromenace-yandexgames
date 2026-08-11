#!/usr/bin/env python3
"""Prepare AstroMenace sources for the Yandex WebAssembly build.

The browser build uses gl4es because AstroMenace relies on a sizeable OpenGL
1.x/2.x compatibility surface. The CI-only patches below also make desktop SDL
window assumptions browser-safe, lock the web render surface to a stable 16:9
resolution, persist completed-mission progress immediately, and notify the
Yandex bridge after every successfully completed mission so it can show an
interstitial between levels.

All edits are applied only to the temporary GitHub Actions worktree. Native
source behaviour in the repository remains unchanged.
"""

from pathlib import Path


def patch_gl_main() -> None:
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


def patch_video_modes() -> None:
    path = Path("src/platform/video.cpp")
    text = path.read_text(encoding="utf-8")

    fullscreen_web = (
        "#ifdef __EMSCRIPTEN__\n"
        "    // Browser fullscreen is controlled by the host page/user gesture,\n"
        "    // not by AstroMenace's desktop display-mode enumeration.\n"
        "    FullscreenSizeArray.clear();\n"
        "    return FullscreenSizeArray;\n"
        "#endif\n\n"
    )
    if "Browser fullscreen is controlled by the host page/user gesture" not in text:
        marker = "const std::vector<sViewSize> &DetectFullscreenSize()\n{\n"
        if marker not in text:
            raise SystemExit("Could not find DetectFullscreenSize insertion point")
        text = text.replace(marker, marker + fullscreen_web, 1)

    window_web = (
        "#ifdef __EMSCRIPTEN__\n"
        "    // Keep one deterministic 16:9 WebGL backbuffer. The CSS shell fits\n"
        "    // this surface inside arbitrary Yandex iframe sizes without stretch.\n"
        "    if (WindowSizeArray.empty()) {\n"
        "        WindowSizeArray.emplace_back(sViewSize{1280, 720});\n"
        "    }\n"
        "    return WindowSizeArray;\n"
        "#endif\n\n"
    )
    if "Keep one deterministic 16:9 WebGL backbuffer" not in text:
        marker = "const std::vector<sViewSize> &DetectWindowSizeArray()\n{\n"
        if marker not in text:
            raise SystemExit("Could not find DetectWindowSizeArray insertion point")
        text = text.replace(marker, marker + window_web, 1)

    path.write_text(text, encoding="utf-8")


def patch_mission_save() -> None:
    path = Path("src/game/game.cpp")
    text = path.read_text(encoding="utf-8")

    include = "#ifdef __EMSCRIPTEN__\n#include <emscripten/emscripten.h>\n#endif\n"
    if "#include <emscripten/emscripten.h>" not in text:
        marker = "#include <iomanip>\n"
        if marker not in text:
            raise SystemExit("Could not find game.cpp Emscripten include insertion point")
        text = text.replace(marker, marker + include, 1)

    flush = (
        "    // The desktop game normally writes profiles when the process/window\n"
        "    // exits. A browser tab may disappear without that shutdown path, so\n"
        "    // persist mission progress before returning to the mission menu.\n"
        "    SaveXMLConfigFile();\n"
        "#ifdef __EMSCRIPTEN__\n"
        "    // Successful mission only: save to Yandex cloud and request the\n"
        "    // between-level fullscreen ad. Yandex controls whether a particular\n"
        "    // interstitial is actually shown when calls are too frequent.\n"
        "    EM_ASM({\n"
        "        if (Module.yandexLevelComplete) {\n"
        "            Module.yandexLevelComplete();\n"
        "        } else if (Module.yandexSyncSave) {\n"
        "            Module.yandexSyncSave(true);\n"
        "        }\n"
        "    });\n"
        "#endif\n\n"
    )
    if "between-level fullscreen ad" not in text:
        marker = (
            "    ChangeGameConfig().Profile[CurrentProfile].LastMission = CurrentMission;\n\n"
            "    ExitGame(Command);\n"
        )
        if marker not in text:
            raise SystemExit("Could not find ExitGameWithSave persistence insertion point")
        replacement = (
            "    ChangeGameConfig().Profile[CurrentProfile].LastMission = CurrentMission;\n\n"
            + flush
            + "    ExitGame(Command);\n"
        )
        text = text.replace(marker, replacement, 1)

    path.write_text(text, encoding="utf-8")


def main() -> int:
    patch_gl_main()
    patch_video_modes()
    patch_mission_save()
    print("Enabled gl4es, browser-safe video modes, mission saves, and level-complete ads.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
