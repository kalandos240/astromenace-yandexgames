#pragma once
#ifdef __EMSCRIPTEN__
extern "C" int AstroMenaceWebIsMobile();
#else
inline int AstroMenaceWebIsMobile() { return 0; }
#endif
