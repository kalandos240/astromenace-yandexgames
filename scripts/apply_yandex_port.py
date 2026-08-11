#!/usr/bin/env python3
from pathlib import Path


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text(encoding='utf-8')
    if new in text:
        return
    if old not in text:
        raise SystemExit(f'Expected patch context not found in {path}: {old[:80]!r}')
    path.write_text(text.replace(old, new, 1), encoding='utf-8')


main = Path('src/main.cpp')
replace_once(
    main,
    '#include <algorithm>\n',
    '''#include <algorithm>\n\n#ifdef __EMSCRIPTEN__\n#include <emscripten.h>\n\nEM_JS(int, AstroMenaceYandexLanguageIndex, (), {\n    return Number.isInteger(Module.yandexLanguageIndex) ? Module.yandexLanguageIndex : 0;\n});\n\nEM_JS(void, AstroMenaceYandexGameReady, (), {\n    if (typeof Module.yandexGameReady === 'function') {\n        Module.yandexGameReady();\n    }\n});\n#endif\n'''
)

replace_once(
    main,
    '    bool FirstStart = false;//LoadXMLConfigFile(NeedResetConfig);\n',
    '''    bool FirstStart = LoadXMLConfigFile(NeedResetConfig);\n#ifdef __EMSCRIPTEN__\n    // Yandex Games requires automatic language detection through the SDK.\n    const int YandexLanguageIndex = AstroMenaceYandexLanguageIndex();\n    if (YandexLanguageIndex >= 0\n        && YandexLanguageIndex < static_cast<int>(vw_GetLanguageListCount())) {\n        ChangeGameConfig().MenuLanguage = static_cast<unsigned>(YandexLanguageIndex);\n        ChangeGameConfig().VoiceLanguage = static_cast<unsigned>(YandexLanguageIndex);\n        // Skip the native first-start language chooser in the web build.\n        FirstStart = false;\n    }\n#endif\n'''
)

replace_once(
    main,
    '    InitMenu(eMenuStatus::MAIN_MENU);\n\n    // Main loop.\n',
    '''    InitMenu(eMenuStatus::MAIN_MENU);\n\n#ifdef __EMSCRIPTEN__\n    // All game assets are loaded and the main menu is interactive at this point.\n    AstroMenaceYandexGameReady();\n#endif\n\n    // Main loop.\n'''
)

path_cpp = Path('src/platform/path.cpp')
replace_once(
    path_cpp,
    '''    // by some reason, SDL use XDG_CONFIG_DATA for preferences/configs, so,\n    // we are forced to use own code instead of SDL_GetPrefPath() for unix\n#ifdef __unix\n''',
    '''    // The web build persists settings/profiles in IDBFS mounted by web/yandex-pre.js.\n#ifdef __EMSCRIPTEN__\n    ConfigPath = "/persistent/";\n#elif defined(__unix)\n    // by some reason, SDL use XDG_CONFIG_DATA for preferences/configs, so,\n    // we are forced to use own code instead of SDL_GetPrefPath() for unix\n'''
)

print('Yandex Games source patches applied.')
