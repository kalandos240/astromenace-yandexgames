/****************************************************************************

    AstroMenace WebAssembly compatibility helpers

    This file supplies the small GLU subset used by AstroMenace when the
    browser build is linked against gl4es. It intentionally implements only
    the functions referenced by the game.

*****************************************************************************/

#ifdef __EMSCRIPTEN__

#include "src/core/graphics/opengl.h"
#include <cmath>

namespace {

constexpr double Pi = 3.141592653589793238462643383279502884;

void Normalize3(double &x, double &y, double &z)
{
    const double len = std::sqrt(x * x + y * y + z * z);
    if (len <= 0.0) {
        return;
    }
    x /= len;
    y /= len;
    z /= len;
}

} // unnamed namespace

extern "C" {

void gluPerspective(GLdouble fovy, GLdouble aspect, GLdouble zNear, GLdouble zFar)
{
    if (aspect == 0.0 || zNear <= 0.0 || zFar <= zNear) {
        return;
    }

    const GLdouble ymax = zNear * std::tan(fovy * Pi / 360.0);
    const GLdouble xmax = ymax * aspect;
    glFrustum(-xmax, xmax, -ymax, ymax, zNear, zFar);
}

void gluLookAt(GLdouble eyeX, GLdouble eyeY, GLdouble eyeZ,
               GLdouble centerX, GLdouble centerY, GLdouble centerZ,
               GLdouble upX, GLdouble upY, GLdouble upZ)
{
    double fx = centerX - eyeX;
    double fy = centerY - eyeY;
    double fz = centerZ - eyeZ;
    Normalize3(fx, fy, fz);

    Normalize3(upX, upY, upZ);

    double sx = fy * upZ - fz * upY;
    double sy = fz * upX - fx * upZ;
    double sz = fx * upY - fy * upX;
    Normalize3(sx, sy, sz);

    const double ux = sy * fz - sz * fy;
    const double uy = sz * fx - sx * fz;
    const double uz = sx * fy - sy * fx;

    const GLfloat matrix[16] = {
        static_cast<GLfloat>(sx), static_cast<GLfloat>(ux), static_cast<GLfloat>(-fx), 0.0f,
        static_cast<GLfloat>(sy), static_cast<GLfloat>(uy), static_cast<GLfloat>(-fy), 0.0f,
        static_cast<GLfloat>(sz), static_cast<GLfloat>(uz), static_cast<GLfloat>(-fz), 0.0f,
        0.0f,                      0.0f,                      0.0f,                       1.0f
    };

    glMultMatrixf(matrix);
    glTranslatef(static_cast<GLfloat>(-eyeX),
                 static_cast<GLfloat>(-eyeY),
                 static_cast<GLfloat>(-eyeZ));
}

GLint gluBuild2DMipmaps(GLenum target, GLint components,
                        GLsizei width, GLsizei height,
                        GLenum format, GLenum type, const void *data)
{
    // gl4es emulates the legacy automatic mipmap path. This fallback is only
    // reached if AstroMenace could not resolve glGenerateMipmap dynamically.
#ifdef GL_GENERATE_MIPMAP
    glTexParameteri(target, GL_GENERATE_MIPMAP, GL_TRUE);
#endif
    glTexImage2D(target, 0, components, width, height, 0, format, type, data);
    return 0;
}

} // extern "C"

#endif // __EMSCRIPTEN__
