from pathlib import Path

p = Path('src/core/particle_system/particle_system.h')
s = p.read_text()
if 'SmokeEmitParticles' not in s:
    s = s.replace('    // Update all particles.', '#if defined(ASTROMENACE_WEB_SMOKE_TEST)\n    void SmokeEmitParticles(unsigned int Quantity);\n#endif\n    // Update all particles.', 1)
p.write_text(s)
p = Path('src/core/particle_system/particle_system.cpp')
s = p.read_text()
if 'SmokeEmitParticles' not in s:
    a = s.index('void cParticleSystem::Draw')
    s = s[:a] + '#if defined(ASTROMENACE_WEB_SMOKE_TEST)\nvoid cParticleSystem::SmokeEmitParticles(unsigned int Quantity) { EmitParticles(Quantity, 0.0f); CalculateAABB(); }\n#endif\n\n' + s[a:]
if 'AstroMenaceWebParticleDrawCalls' not in s:
    a = s.index('void cParticleSystem::Draw')
    s = s[:a] + 'static unsigned ParticleDrawCalls = 0, ParticleVisibleCount = 0;\n' + s[a:]
    s = s.replace('Indices.data());', 'Indices.data());\n    ++ParticleDrawCalls; ParticleVisibleCount += ParticlesCountInList;', 1)
    for name in ['void vw_DrawAllParticleSystems()', 'void vw_DrawParticleSystems(']:
        a = s.index(name)
        b = s.index('\n/*', a) if '\n/*' in s[a:] else len(s)
        chunk = s[a:b].replace('    glDepthMask(GL_FALSE);', '    glDepthMask(GL_FALSE);\n    ParticleDrawCalls = ParticleVisibleCount = 0;', 1)
        s = s[:a] + chunk + s[b:]
    s += '''
#if defined(__EMSCRIPTEN__) && defined(ASTROMENACE_WEB_SMOKE_TEST)
#include <emscripten.h>
extern "C" EMSCRIPTEN_KEEPALIVE unsigned AstroMenaceWebParticleDrawCalls() { return viewizard::ParticleDrawCalls; }
extern "C" EMSCRIPTEN_KEEPALIVE unsigned AstroMenaceWebParticleVisibleCount() { return viewizard::ParticleVisibleCount; }
#endif
'''
p.write_text(s)
p = Path('src/core/graphics/gl_vbo.cpp')
s = p.read_text()
if 'AstroMenaceWebBufferCreates' not in s:
    s = s.replace('namespace viewizard {', 'namespace viewizard {\n#if defined(ASTROMENACE_WEB_SMOKE_TEST)\nstatic unsigned BufferCreates = 0, BufferDeletes = 0, BufferUpdates = 0;\n#endif', 1)
    for marker, counter in [('    pfn_glGenBuffers(1, &buffer);', 'BufferCreates'), ('    pfn_glDeleteBuffers(1, &buffer);', 'BufferDeletes'), ('    pfn_glBufferSubData(static_cast<GLenum>(target), 0, size, data);', 'BufferUpdates')]:
        if marker in s:
            s = s.replace(marker, '#if defined(ASTROMENACE_WEB_SMOKE_TEST)\n    ++' + counter + ';\n#endif\n' + marker, 1)
    s += '''
#if defined(__EMSCRIPTEN__) && defined(ASTROMENACE_WEB_SMOKE_TEST)
#include <emscripten.h>
extern "C" EMSCRIPTEN_KEEPALIVE unsigned AstroMenaceWebBufferCreates() { return viewizard::BufferCreates; }
extern "C" EMSCRIPTEN_KEEPALIVE unsigned AstroMenaceWebBufferDeletes() { return viewizard::BufferDeletes; }
extern "C" EMSCRIPTEN_KEEPALIVE unsigned AstroMenaceWebBufferUpdates() { return viewizard::BufferUpdates; }
extern "C" EMSCRIPTEN_KEEPALIVE void AstroMenaceWebResetBufferStats() { viewizard::BufferCreates = viewizard::BufferDeletes = viewizard::BufferUpdates = 0; }
#endif
'''
p.write_text(s)
