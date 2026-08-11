#!/usr/bin/env python3
from pathlib import Path

path = Path('src/main.cpp')
text = path.read_text(encoding='utf-8')

start_marker = '''/*
 * Main loop.
 */
static void Loop()
{
'''
end_marker = '''
} // astromenace namespace
} // viewizard namespace
'''

start = text.find(start_marker)
end = text.find(end_marker, start)
if start < 0 or end < 0:
    raise SystemExit('Could not locate AstroMenace main loop block')

if 'static void EmscriptenLoop(void *)' in text[start:end]:
    print('Web main-loop patch already applied.')
    raise SystemExit(0)

replacement = r'''/*
 * Run one game-loop iteration.
 *
 * Native builds call this from a blocking while-loop. The browser build is
 * scheduled by Emscripten so control returns to the browser between frames.
 */
static bool NeedPause{false};
static bool TimeThreadsPaused{false};

static void LoopIteration()
{
    SDL_Event event;
    while (SDL_PollEvent(&event)) {
        switch (event.type) {
        case SDL_QUIT: // close window by ALT+F4 or click on window's 'close' button
            if (MenuStatus == eMenuStatus::GAME) {
                SetCurrentDialogBox(eDialogBox::QuitNoSave);
            } else {
                SetCurrentDialogBox(eDialogBox::QuitFromGame);
            }
            break;

        case SDL_MOUSEMOTION:
            vw_SetMousePos(event.motion.x, event.motion.y);
            // in case we have mouse movement, reset keyboard selected menu element
            CurrentKeyboardSelectMenuElement = 0;
            break;
        case SDL_MOUSEWHEEL:
            vw_ChangeWheelStatus(-event.wheel.y);
            break;
        case SDL_MOUSEBUTTONDOWN:
            vw_SetMouseButtonStatus(event.button.button, true);
            if (event.button.button == SDL_BUTTON_LEFT) {
                vw_SetMouseLeftClick(true);
            }
            if (event.button.button == SDL_BUTTON_RIGHT) {
                vw_SetMouseRightClick(true);
            }
            if (event.button.clicks == 2 && event.button.button == SDL_BUTTON_LEFT) {
                vw_SetMouseLeftDoubleClick(true);
            }
            break;
        case SDL_MOUSEBUTTONUP:
            vw_SetMouseButtonStatus(event.button.button, false);
            if (event.button.button == SDL_BUTTON_LEFT) {
                vw_SetMouseLeftClick(false);
            }
            if (event.button.button == SDL_BUTTON_RIGHT) {
                vw_SetMouseRightClick(false);
            }
            if (event.button.clicks == 2 && event.button.button == SDL_BUTTON_LEFT) {
                vw_SetMouseLeftDoubleClick(false);
            }
            break;

        case SDL_JOYBUTTONDOWN:
            vw_SetMouseLeftClick(true);
            SetJoystickButton(event.jbutton.button, true);
            break;
        case SDL_JOYBUTTONUP:
            vw_SetMouseLeftClick(false);
            SetJoystickButton(event.jbutton.button, false);
            break;
        case SDL_JOYDEVICEADDED:
        case SDL_JOYDEVICEREMOVED:
            JoystickInit(vw_GetTimeThread(0));
            break;

        case SDL_WINDOWEVENT:
            switch (event.window.event) {
            case SDL_WINDOWEVENT_FOCUS_LOST:
            case SDL_WINDOWEVENT_MINIMIZED:
                NeedPause = true;
                break;
            case SDL_WINDOWEVENT_FOCUS_GAINED:
            case SDL_WINDOWEVENT_RESTORED:
                NeedPause = false;
                break;
            }
            break;

        case SDL_KEYUP:
            vw_KeyStatusUpdate(event.key.keysym.sym);
            break;

        case SDL_TEXTINPUT:
            vw_SetCurrentUnicodeChar(event.text.text);
#ifndef NDEBUG
            std::cout << "TextInput, Unicode: " << event.text.text << "\n";
#endif
            break;

        default:
            break;
        }
    }

    if (!NeedPause) {
#ifdef __EMSCRIPTEN__
        if (TimeThreadsPaused) {
            vw_ResumeTimeThreads();
            TimeThreadsPaused = false;
        }
#endif
        JoystickEmulateMouseMovement(vw_GetTimeThread(0));
        Loop_Proc();
        AudioLoop();
        return;
    }

    // turn off music while the tab/platform has paused the game
    if (vw_IsAnyMusicPlaying()) {
        vw_ReleaseAllMusic();
    }

    // pause, so, player doesn't lose anything
    if ((MenuStatus == eMenuStatus::GAME) && (GameContentTransp < 1.0f)) {
        NeedShowGameMenu = true;
        NeedHideGameMenu = false;
        GameContentTransp = 1.0f;
        cGameSpeed::GetInstance().SetThreadSpeed(0.0f);
        SetShowGameCursor(true);
    }

#ifdef __EMSCRIPTEN__
    // SDL_WaitEvent() would block the browser main thread. Pause time once and
    // simply return to JavaScript; focus/game_api_resume will resume us later.
    if (!TimeThreadsPaused) {
        vw_PauseTimeThreads();
        TimeThreadsPaused = true;
    }
#else
    vw_PauseTimeThreads();
    SDL_WaitEvent(nullptr);
    vw_ResumeTimeThreads();
#endif
}

#ifdef __EMSCRIPTEN__
static void EmscriptenLoop(void *)
{
    if (NeedQuitFromLoop) {
        emscripten_cancel_main_loop();
        return;
    }
    LoopIteration();
}
#endif

/*
 * Main loop.
 */
static void Loop()
{
    NeedQuitFromLoop = false;
    NeedRecreateWindow = false;
    NeedPause = false;
    TimeThreadsPaused = false;

#ifdef __EMSCRIPTEN__
    // Rendering work must yield to the browser after every frame. A blocking
    // desktop-style while-loop would freeze the page and prevent WebGL/events.
    emscripten_set_main_loop_arg(EmscriptenLoop, nullptr, 0, 1);
#else
    while (!NeedQuitFromLoop) {
        LoopIteration();
    }
#endif
}
'''

new_text = text[:start] + replacement + text[end:]
path.write_text(new_text, encoding='utf-8')
print('Converted AstroMenace loop to browser-scheduled Emscripten main loop.')
