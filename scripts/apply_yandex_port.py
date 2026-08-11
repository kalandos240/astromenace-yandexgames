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

# FreeALUT only initializes/checks OpenAL in AstroMenace. Emscripten ships its own
# OpenAL implementation, so the web build can avoid the unavailable ALUT dependency.
openal_h = Path('src/core/audio/openal.h')
replace_once(
    openal_h,
    '#include "AL/alut.h"\n',
    '''#ifndef __EMSCRIPTEN__\n#include "AL/alut.h"\n#endif\n'''
)

openal_cpp = Path('src/core/audio/openal.cpp')
replace_once(
    openal_cpp,
    '''ALboolean CheckALUTError(const char *FunctionName)\n{\n    ALenum ErrCode;\n    if ((ErrCode = alutGetError()) != ALUT_ERROR_NO_ERROR) {\n        std::cerr << FunctionName << "(): " << "OpenAL alut error: " << alutGetErrorString(ErrCode) << "\\n";\n        return AL_FALSE;\n    }\n    return AL_TRUE;\n}\n''',
    '''ALboolean CheckALUTError(const char *FunctionName)\n{\n#ifdef __EMSCRIPTEN__\n    (void)FunctionName;\n    return AL_TRUE;\n#else\n    ALenum ErrCode;\n    if ((ErrCode = alutGetError()) != ALUT_ERROR_NO_ERROR) {\n        std::cerr << FunctionName << "(): " << "OpenAL alut error: " << alutGetErrorString(ErrCode) << "\\n";\n        return AL_FALSE;\n    }\n    return AL_TRUE;\n#endif\n}\n'''
)

audio_cpp = Path('src/core/audio/audio.cpp')
replace_once(
    audio_cpp,
    '''    alutInitWithoutContext(nullptr, nullptr);\n    if (!CheckALUTError(__func__)) {\n        return false;\n    }\n''',
    '''#ifndef __EMSCRIPTEN__\n    alutInitWithoutContext(nullptr, nullptr);\n    if (!CheckALUTError(__func__)) {\n        return false;\n    }\n#endif\n'''
)
replace_once(
    audio_cpp,
    '''    std::cout << "ALut ver   : " << alutGetMajorVersion() << "." << alutGetMinorVersion() << "\\n";\n''',
    '''#ifndef __EMSCRIPTEN__\n    std::cout << "ALut ver   : " << alutGetMajorVersion() << "." << alutGetMinorVersion() << "\\n";\n#endif\n'''
)
replace_once(
    audio_cpp,
    '''    alutExit();\n    CheckALUTError(__func__);\n    AlutInitStatus = false;\n''',
    '''#ifndef __EMSCRIPTEN__\n    alutExit();\n    CheckALUTError(__func__);\n#endif\n    AlutInitStatus = false;\n'''
)

# Modern Emscripten ports for the libraries used by AstroMenace.
cmake = Path('CMakeLists.txt')
replace_once(
    cmake,
    '''SET(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -I../include -sUSE_SDL=2 -sUSE_SDL_MIXER=2 -sUSE_FREETYPE")\n''',
    '''IF(EMSCRIPTEN)\n    SET(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -sUSE_SDL=2 -sUSE_FREETYPE=1 -sUSE_OGG=1 -sUSE_VORBIS=1")\nELSE()\n    SET(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -I../include")\nENDIF()\n'''
)
replace_once(
    cmake,
    '''    ELSE(OPENGL_FOUND)\n        MESSAGE(FATAL_ERROR "OpenGL not found")\n    ENDIF(OPENGL_FOUND)\n''',
    '''    ELSE(OPENGL_FOUND)\n        IF(NOT EMSCRIPTEN)\n            MESSAGE(FATAL_ERROR "OpenGL not found")\n        ENDIF()\n    ENDIF(OPENGL_FOUND)\n'''
)

print('Yandex Games source patches applied.')
