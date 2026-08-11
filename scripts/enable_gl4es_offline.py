#!/usr/bin/env python3
"""Prepare AstroMenace for the fast offline/Yandex WebAssembly build.

This is intentionally separate from the legacy browser pipeline. It applies
web-only source edits in the temporary Actions worktree:
- gl4es initialization and browser-safe video modes;
- immediate mission save + Yandex interstitial hook;
- cooperative Asyncify startup yields so the browser remains responsive;
- removal of the desktop 4-second Viewizard splash and native loading renderer;
- lightweight HTML loading progress during asset initialization.
"""

from pathlib import Path


def patch_gl_main() -> None:
    path = Path("src/core/graphics/gl_main.cpp")
    text = path.read_text(encoding="utf-8")

    include = "#ifdef __EMSCRIPTEN__\n#include <gl4esinit.h>\n#endif\n\n"
    if "#include <gl4esinit.h>" not in text:
        marker = "#include <algorithm>\n"
        if marker not in text:
            raise SystemExit("gl_main include insertion point not found")
        text = text.replace(marker, include + marker, 1)

    web_window = (
        "#ifdef __EMSCRIPTEN__\n"
        "    Fullscreen = false;\n"
        "#endif\n\n"
    )
    if "Fullscreen = false;" not in text:
        marker = "    Uint32 Flags{SDL_WINDOW_OPENGL};\n"
        if marker not in text:
            raise SystemExit("SDL window flags insertion point not found")
        text = text.replace(marker, web_window + marker, 1)

    init = "#ifdef __EMSCRIPTEN__\n    initialize_gl4es();\n#endif\n\n"
    if "initialize_gl4es();" not in text:
        marker = "    if (SDL_GL_SetSwapInterval(VSync) == -1) {\n"
        if marker not in text:
            raise SystemExit("gl4es initialization insertion point not found")
        text = text.replace(marker, init + marker, 1)

    path.write_text(text, encoding="utf-8")


def patch_video_modes() -> None:
    path = Path("src/platform/video.cpp")
    text = path.read_text(encoding="utf-8")

    fullscreen_web = (
        "#ifdef __EMSCRIPTEN__\n"
        "    FullscreenSizeArray.clear();\n"
        "    return FullscreenSizeArray;\n"
        "#endif\n\n"
    )
    marker = "const std::vector<sViewSize> &DetectFullscreenSize()\n{\n"
    if "FullscreenSizeArray.clear();" not in text:
        if marker not in text:
            raise SystemExit("DetectFullscreenSize insertion point not found")
        text = text.replace(marker, marker + fullscreen_web, 1)

    window_web = (
        "#ifdef __EMSCRIPTEN__\n"
        "    if (WindowSizeArray.empty()) {\n"
        "        WindowSizeArray.emplace_back(sViewSize{1280, 720});\n"
        "    }\n"
        "    return WindowSizeArray;\n"
        "#endif\n\n"
    )
    marker = "const std::vector<sViewSize> &DetectWindowSizeArray()\n{\n"
    if "WindowSizeArray.emplace_back(sViewSize{1280, 720});" not in text:
        if marker not in text:
            raise SystemExit("DetectWindowSizeArray insertion point not found")
        text = text.replace(marker, marker + window_web, 1)

    path.write_text(text, encoding="utf-8")


def patch_mission_save() -> None:
    path = Path("src/game/game.cpp")
    text = path.read_text(encoding="utf-8")

    include = "#ifdef __EMSCRIPTEN__\n#include <emscripten/emscripten.h>\n#endif\n"
    if "#include <emscripten/emscripten.h>" not in text:
        marker = "#include <iomanip>\n"
        if marker not in text:
            raise SystemExit("game.cpp include insertion point not found")
        text = text.replace(marker, marker + include, 1)

    if "Module.yandexLevelComplete" not in text:
        marker = (
            "    ChangeGameConfig().Profile[CurrentProfile].LastMission = CurrentMission;\n\n"
            "    ExitGame(Command);\n"
        )
        if marker not in text:
            raise SystemExit("mission completion insertion point not found")
        hook = (
            "    ChangeGameConfig().Profile[CurrentProfile].LastMission = CurrentMission;\n\n"
            "    SaveXMLConfigFile();\n"
            "#ifdef __EMSCRIPTEN__\n"
            "    EM_ASM({\n"
            "        if (Module.yandexLevelComplete) {\n"
            "            Module.yandexLevelComplete();\n"
            "        } else if (Module.yandexSyncSave) {\n"
            "            Module.yandexSyncSave(true);\n"
            "        }\n"
            "    });\n"
            "#endif\n\n"
            "    ExitGame(Command);\n"
        )
        text = text.replace(marker, hook, 1)

    path.write_text(text, encoding="utf-8")


def web_status(message: str) -> str:
    return (
        "#ifdef __EMSCRIPTEN__\n"
        "    EM_ASM({ if (Module.yandexSetStatus) Module.yandexSetStatus('"
        + message
        + "'); });\n"
        "#ifdef ASTROMENACE_WEB_ASYNC_STARTUP\n"
        "    emscripten_sleep(0);\n"
        "#endif\n"
        "#endif\n"
    )


def patch_startup_yields() -> None:
    path = Path("src/main.cpp")
    text = path.read_text(encoding="utf-8")

    if "Fast web startup: initializing SDL" in text:
        return

    stages = [
        (
            "    LogGameAndLibsVersion();\n",
            "    LogGameAndLibsVersion();\n\n"
            "    // Fast web startup: initializing SDL.\n"
            + web_status("Initializing SDL...")
        ),
        (
            "    if (vw_OpenVFS(GetDataPath() + \"gamedata.vfs\", GAME_VFS_BUILD) != 0) {\n",
            web_status("Opening game data...")
            + "    if (vw_OpenVFS(GetDataPath() + \"gamedata.vfs\", GAME_VFS_BUILD) != 0) {\n"
        ),
        (
            "    if (!VideoConfig(FirstStart)) {\n",
            web_status("Configuring video...")
            + "    if (!VideoConfig(FirstStart)) {\n"
        ),
        (
            "RecreateWindow:\n\n    if (!vw_CreateWindow",
            "RecreateWindow:\n\n"
            + web_status("Creating WebGL renderer...")
            + "    if (!vw_CreateWindow"
        ),
        (
            "    GenerateFonts(); // should be called after vw_InitText() and InitFont()\n",
            web_status("Generating fonts...")
            + "    GenerateFonts(); // should be called after vw_InitText() and InitFont()\n"
        ),
        (
            "    LoadAllGameAssets(); // should be called after GenerateFonts(), since we use fonts for 'LOADING' text\n",
            web_status("Loading game assets... 0%")
            + "    LoadAllGameAssets(); // should be called after GenerateFonts(), since we use fonts for 'LOADING' text\n"
        ),
        (
            "    InitMenu(eMenuStatus::MAIN_MENU);\n",
            web_status("Opening main menu...")
            + "    InitMenu(eMenuStatus::MAIN_MENU);\n"
        ),
    ]

    for marker, replacement in stages:
        if marker not in text:
            raise SystemExit(f"startup insertion point not found: {marker!r}")
        text = text.replace(marker, replacement, 1)

    path.write_text(text, encoding="utf-8")


def patch_fast_asset_loading() -> None:
    path = Path("src/assets/loading.cpp")
    text = path.read_text(encoding="utf-8")

    if "ASTROMENACE FAST WEB ASSET LOADER" in text:
        return

    include_marker = '#include "SDL2/SDL.h"\n'
    include = (
        '#include "SDL2/SDL.h"\n'
        '#ifdef __EMSCRIPTEN__\n'
        '#include <emscripten/emscripten.h>\n'
        '#endif\n'
    )
    if include_marker not in text:
        raise SystemExit("loading.cpp SDL include not found")
    text = text.replace(include_marker, include, 1)

    start = text.find("void LoadAllGameAssets()\n{")
    end_marker = "\n}\n\n} // astromenace namespace"
    end = text.find(end_marker, start)
    if start < 0 or end < 0:
        raise SystemExit("LoadAllGameAssets function bounds not found")

    replacement = r'''void LoadAllGameAssets()
{
    // ASTROMENACE FAST WEB ASSET LOADER
    // The native build displays a ~4 second Viewizard splash and continuously
    // renders a GL loading screen. In a browser both operations block the main
    // thread and significantly delay first interaction. The web package already
    // has an HTML loading overlay, so load assets directly and yield periodically.

    auto StartupTick = [] () {
        AudioLoop();
#ifdef ASTROMENACE_WEB_ASYNC_STARTUP
        emscripten_sleep(0);
#endif
    };

    if (GameConfig().UseGLSL120) {
        ChangeGameConfig().UseGLSL120 = ForEachShaderAssetLoad(StartupTick);
    }

    unsigned RealLoadedAssets{0};
    const unsigned AllDrawLoading{GetAudioAssetsLoadValue() +
                                  GetModel3DAssetsLoadValue() +
                                  GetTextureAssetsLoadValue()};
    unsigned NextYield{1};

    auto UpdateLoadStatus = [&] (unsigned AssetValue) {
        RealLoadedAssets += AssetValue;
        if (RealLoadedAssets >= NextYield || RealLoadedAssets >= AllDrawLoading) {
            const int Percent = AllDrawLoading
                ? static_cast<int>(100u * RealLoadedAssets / AllDrawLoading)
                : 100;
            EM_ASM({
                if (Module.yandexSetStatus) {
                    Module.yandexSetStatus('Loading game assets... ' + $0 + '%');
                }
            }, Percent > 100 ? 100 : Percent);
#ifdef ASTROMENACE_WEB_ASYNC_STARTUP
            emscripten_sleep(0);
#endif
            // Yield roughly 32 times across the complete asset set. This keeps
            // Firefox/Chromium responsive without paying a yield cost per file.
            const unsigned Step = AllDrawLoading > 32 ? AllDrawLoading / 32 : 1;
            NextYield = RealLoadedAssets + Step;
        }
        AudioLoop();
    };

    ForEachAudioAssetLoad(UpdateLoadStatus);
    ForEachModel3DAssetLoad(UpdateLoadStatus);
    ForEachTextureAssetLoad(UpdateLoadStatus);
}
'''
    # end points to the newline immediately before the old function's closing
    # brace. Skip that newline and brace, but keep the namespace close that
    # follows it.
    text = text[:start] + replacement + text[end + 2:]
    path.write_text(text, encoding="utf-8")


def main() -> int:
    patch_gl_main()
    patch_video_modes()
    patch_mission_save()
    patch_startup_yields()
    patch_fast_asset_loading()
    print("Prepared fast offline/Yandex AstroMenace WebAssembly sources.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
