#!/usr/bin/env python3
from pathlib import Path

path = Path('src/core/graphics/gl_main.cpp')
text = path.read_text(encoding='utf-8')
text = text.replace('#include <gl4esinit.h>\n\n', '')
text = text.replace('    initialize_gl4es();\n\n', '')
path.write_text(text, encoding='utf-8')
print('Removed obsolete gl4es dependency; Emscripten supplies the WebGL/OpenGL compatibility layer.')
