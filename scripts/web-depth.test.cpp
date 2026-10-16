#include "WebDepthReadback.h"
#include <emscripten.h>
#include <emscripten/html5.h>
#include <sstream>
#include <string>

static GLuint MakeProgram() {
    const char* vertex = "#version 300 es\nvoid main(){gl_Position=vec4(0.0);}";
    const char* fragment = "#version 300 es\nprecision highp float;out vec4 "
                           "c;void main(){c=vec4(1.0);}";
    GLuint vs = glCreateShader(GL_VERTEX_SHADER), fs = glCreateShader(GL_FRAGMENT_SHADER);
    glShaderSource(vs, 1, &vertex, nullptr);
    glShaderSource(fs, 1, &fragment, nullptr);
    glCompileShader(vs);
    glCompileShader(fs);
    GLuint program = glCreateProgram();
    glAttachShader(program, vs);
    glAttachShader(program, fs);
    glLinkProgram(program);
    glDeleteShader(vs);
    glDeleteShader(fs);
    return program;
}

static std::vector<GLint> State() {
    std::vector<GLint> result;
    for (GLenum name :
         { GL_READ_FRAMEBUFFER_BINDING, GL_DRAW_FRAMEBUFFER_BINDING, GL_CURRENT_PROGRAM, GL_VERTEX_ARRAY_BINDING,
           GL_ACTIVE_TEXTURE, GL_PIXEL_PACK_BUFFER_BINDING, GL_PIXEL_UNPACK_BUFFER_BINDING, GL_PACK_ALIGNMENT,
           GL_PACK_ROW_LENGTH, GL_PACK_SKIP_ROWS, GL_PACK_SKIP_PIXELS }) {
        GLint value;
        glGetIntegerv(name, &value);
        result.push_back(value);
    }
    GLint viewport[4];
    GLboolean mask[4];
    glGetIntegerv(GL_VIEWPORT, viewport);
    glGetBooleanv(GL_COLOR_WRITEMASK, mask);
    result.insert(result.end(), viewport, viewport + 4);
    result.insert(result.end(), mask, mask + 4);
    for (GLenum name : { GL_BLEND, GL_DEPTH_TEST, GL_STENCIL_TEST, GL_SCISSOR_TEST, GL_CULL_FACE, GL_DITHER,
                         GL_RASTERIZER_DISCARD }) {
        result.push_back(glIsEnabled(name));
    }
    GLint active;
    glGetIntegerv(GL_ACTIVE_TEXTURE, &active);
    for (GLenum unit : { GL_TEXTURE0, GL_TEXTURE3 }) {
        glActiveTexture(unit);
        GLint texture, sampler;
        glGetIntegerv(GL_TEXTURE_BINDING_2D, &texture);
        glGetIntegerv(GL_SAMPLER_BINDING, &sampler);
        result.push_back(texture);
        result.push_back(sampler);
    }
    glActiveTexture(active);
    return result;
}

extern "C" EMSCRIPTEN_KEEPALIVE void RunDepthTests() {
    std::ostringstream report;
    int failures = 0, checks = 0;
    auto check = [&](bool passed, const std::string& name) {
        ++checks;
        failures += !passed;
        report << (passed ? "PASS " : "FAIL ") << name << '\n';
    };
    GLuint source, depth, color, vao, textures[2], sampler, buffers[2];
    glGenFramebuffers(1, &source);
    glBindFramebuffer(GL_FRAMEBUFFER, source);
    glGenRenderbuffers(1, &depth);
    glBindRenderbuffer(GL_RENDERBUFFER, depth);
    glRenderbufferStorage(GL_RENDERBUFFER, GL_DEPTH24_STENCIL8, 5, 2);
    glFramebufferRenderbuffer(GL_FRAMEBUFFER, GL_DEPTH_STENCIL_ATTACHMENT, GL_RENDERBUFFER, depth);
    glGenTextures(1, &color);
    glBindTexture(GL_TEXTURE_2D, color);
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, 5, 2, 0, GL_RGBA, GL_UNSIGNED_BYTE, nullptr);
    glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, color, 0);
    check(glCheckFramebufferStatus(GL_FRAMEBUFFER) == GL_FRAMEBUFFER_COMPLETE, "source framebuffer");
    const float depths[] = { 0.0f, 0.12345f, 0.5f, 0.99999f, 1.0f };
    glEnable(GL_SCISSOR_TEST);
    glDepthMask(GL_TRUE);
    glStencilMask(0xFF);
    for (GLuint fb : { source, GLuint(0) }) {
        glBindFramebuffer(GL_FRAMEBUFFER, fb);
        for (int y = 0; y < 2; ++y) {
            for (int x = 0; x < 5; ++x) {
                glScissor(x, y, 1, 1);
                glClearDepthf(depths[y ? 4 - x : x]);
                glClearStencil(x);
                glClearColor(y, float(x) / 4.0f, 0, 1);
                glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT | GL_STENCIL_BUFFER_BIT);
            }
        }
    }
    glBindFramebuffer(GL_FRAMEBUFFER, source);
    uint8_t sourceColors[40];
    glReadPixels(0, 0, 5, 2, GL_RGBA, GL_UNSIGNED_BYTE, sourceColors);
    for (int i = 0; i < 10; ++i) {
        check(sourceColors[i * 4] == (i >= 5 ? 255 : 0), "source row " + std::to_string(i));
    }
    glGenVertexArrays(1, &vao);
    glBindVertexArray(vao);
    GLuint program = MakeProgram();
    glUseProgram(program);
    glGenTextures(2, textures);
    glGenSamplers(1, &sampler);
    glActiveTexture(GL_TEXTURE0);
    glBindTexture(GL_TEXTURE_2D, textures[0]);
    glBindSampler(0, sampler);
    glActiveTexture(GL_TEXTURE3);
    glBindTexture(GL_TEXTURE_2D, textures[1]);
    glBindSampler(3, sampler);
    glGenBuffers(2, buffers);
    glBindBuffer(GL_PIXEL_PACK_BUFFER, buffers[0]);
    glBufferData(GL_PIXEL_PACK_BUFFER, 256, nullptr, GL_STREAM_READ);
    glBindBuffer(GL_PIXEL_UNPACK_BUFFER, buffers[1]);
    glBufferData(GL_PIXEL_UNPACK_BUFFER, 256, nullptr, GL_STREAM_DRAW);
    glPixelStorei(GL_PACK_ALIGNMENT, 8);
    glPixelStorei(GL_PACK_ROW_LENGTH, 17);
    glPixelStorei(GL_PACK_SKIP_ROWS, 2);
    glPixelStorei(GL_PACK_SKIP_PIXELS, 3);
    glViewport(2, 3, 13, 11);
    glColorMask(GL_FALSE, GL_TRUE, GL_FALSE, GL_TRUE);
    for (GLenum name : { GL_BLEND, GL_DEPTH_TEST, GL_STENCIL_TEST, GL_SCISSOR_TEST, GL_CULL_FACE, GL_DITHER,
                         GL_RASTERIZER_DISCARD }) {
        glEnable(name);
    }
    glBindFramebuffer(GL_READ_FRAMEBUFFER, source);
    glBindFramebuffer(GL_DRAW_FRAMEBUFFER, 0);
    check(glGetError() == GL_NO_ERROR, "test setup GL errors");

    ShipWeb::DepthReadback reader;
    std::vector<uint16_t> values;
    auto before = State();
    check(reader.Read(source, 5, 2, { { 2, 0 } }, values), "single pixel read");
    check(values.size() == 1 && values[0] == 32768, "single pixel native depth precision");
    check(State() == before, "GL state restored after initialization");
    check(glGetError() == GL_NO_ERROR, "single pixel GL errors");
    reader.Read(source, 5, 2, { { 0, 1 } }, values);
    check(values[0] == 65532, "single pixel second row");

    std::vector<std::pair<int, int>> coordinates;
    for (int y = 0; y < 2; ++y) {
        for (int x = 0; x < 5; ++x) {
            coordinates.emplace_back(x, y);
        }
    }
    coordinates.insert(coordinates.end(), { { -1, 0 }, { 5, 0 }, { 0, -1 }, { 0, 2 } });
    check(reader.Read(source, 5, 2, coordinates, values), "batched read after resizing");
    bool precision = true;
    for (int i = 0; i < 10; ++i) {
        const int x = i % 5, y = i / 5;
        const uint16_t expected = (uint32_t(std::round(double(depths[y ? 4 - x : x]) * 16777215.0)) >> 10) << 2;
        precision &= std::abs(int(values[i]) - int(expected)) <= 4;
        report << "  depth " << depths[y ? 4 - x : x] << ": " << values[i] << " expected " << expected << '\n';
    }
    check(precision, "batched 14-bit precision and row coordinates");
    check(values[10] == 0 && values[11] == 0 && values[12] == 0 && values[13] == 0, "out-of-bounds depth");
    check(State() == before, "GL state restored after resizing");
    check(glGetError() == GL_NO_ERROR, "batched GL errors");
    check(reader.Read(0, 32, 32, { { 0, 0 }, { 4, 0 }, { 0, 1 } }, values), "default framebuffer depth read");
    check(values[0] == 0 && values[1] == 65532 && values[2] == 65532, "default framebuffer depth precision");
    check(State() == before, "GL state restored after reuse");
    check(glGetError() == GL_NO_ERROR, "default framebuffer GL errors");
    check(reader.Read(source, 5, 2, {}, values) && values.empty(), "empty coordinate set");
    report << '\n' << checks - failures << '/' << checks << " checks passed";
    const std::string text = report.str();
    EM_ASM({ document.getElementById('report').textContent = UTF8ToString($0); }, text.c_str());
}

int main() {
    EmscriptenWebGLContextAttributes attributes;
    emscripten_webgl_init_context_attributes(&attributes);
    attributes.majorVersion = 2;
    attributes.depth = true;
    attributes.stencil = true;
    attributes.antialias = false;
    auto context = emscripten_webgl_create_context("#canvas", &attributes);
    emscripten_webgl_make_context_current(context);
    return 0;
}
