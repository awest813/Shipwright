#pragma once

#include <GLES3/gl3.h>
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <utility>
#include <vector>

namespace ShipWeb {

// WebGL2 cannot read DEPTH_STENCIL pixels directly. Copy depth to a sampleable
// texture, encode requested native 14-bit values in RGBA8, then read them. A
// full-size copy preserves row coordinates on drivers that mishandle small
// depth/stencil blits. Private GL objects live for the context lifetime.
class DepthReadback {
  public:
    bool Read(GLuint source, int width, int height, const std::vector<std::pair<int, int>>& coordinates,
              std::vector<uint16_t>& values) {
        values.assign(coordinates.size(), 0xFFFC);
        if (coordinates.empty()) {
            return true;
        }
        State state;
        if (!Initialize()) {
            return false;
        }
        glActiveTexture(GL_TEXTURE0);
        glBindSampler(0, 0);
        glBindBuffer(GL_PIXEL_PACK_BUFFER, 0);
        glBindBuffer(GL_PIXEL_UNPACK_BUFFER, 0);
        glPixelStorei(GL_PACK_ALIGNMENT, 1);
        glPixelStorei(GL_PACK_ROW_LENGTH, 0);
        glPixelStorei(GL_PACK_SKIP_ROWS, 0);
        glPixelStorei(GL_PACK_SKIP_PIXELS, 0);
        for (GLenum capability : State::Capabilities) {
            glDisable(capability);
        }
        glColorMask(GL_TRUE, GL_TRUE, GL_TRUE, GL_TRUE);
        glUseProgram(mProgram);
        glBindVertexArray(mVao);

        for (size_t offset = 0; offset < coordinates.size();) {
            const int count = static_cast<int>(std::min(coordinates.size() - offset, size_t(mMaxTextureSize)));
            if (!Allocate(count, width, height)) {
                return false;
            }
            glBindFramebuffer(GL_READ_FRAMEBUFFER, source);
            glBindFramebuffer(GL_DRAW_FRAMEBUFFER, mDepthFb);
            glBlitFramebuffer(0, 0, width, height, 0, 0, width, height, GL_DEPTH_BUFFER_BIT | GL_STENCIL_BUFFER_BIT,
                              GL_NEAREST);
            glBindFramebuffer(GL_FRAMEBUFFER, mColorFb);
            glBindTexture(GL_TEXTURE_2D, mDepthTexture);
            for (int i = 0; i < count; ++i) {
                const auto [x, y] = coordinates[offset + i];
                glUniform2i(mPixelLocation, std::clamp(x, 0, width - 1), std::clamp(y, 0, height - 1));
                glViewport(i, 0, 1, 1);
                glDrawArrays(GL_TRIANGLES, 0, 3);
            }
            mPixels.resize(count * 4);
            glReadPixels(0, 0, count, 1, GL_RGBA, GL_UNSIGNED_BYTE, mPixels.data());
            for (int i = 0; i < count; ++i) {
                const auto [x, y] = coordinates[offset + i];
                values[offset + i] = x >= 0 && y >= 0 && x < width && y < height
                                         ? uint16_t((uint16_t(mPixels[i * 4]) << 8) | mPixels[i * 4 + 1])
                                         : 0;
            }
            offset += count;
        }
        return true;
    }

  private:
    struct State {
        inline static constexpr GLenum Capabilities[] = {
            GL_BLEND, GL_DEPTH_TEST, GL_STENCIL_TEST, GL_SCISSOR_TEST, GL_CULL_FACE, GL_DITHER, GL_RASTERIZER_DISCARD
        };
        GLint readFb, drawFb, viewport[4], program, vao, activeTexture, texture, sampler;
        GLint packBuffer, unpackBuffer, packAlignment, packRowLength, packSkipRows, packSkipPixels;
        GLboolean colorMask[4], enabled[7];

        State() {
            glGetIntegerv(GL_READ_FRAMEBUFFER_BINDING, &readFb);
            glGetIntegerv(GL_DRAW_FRAMEBUFFER_BINDING, &drawFb);
            glGetIntegerv(GL_VIEWPORT, viewport);
            glGetIntegerv(GL_CURRENT_PROGRAM, &program);
            glGetIntegerv(GL_VERTEX_ARRAY_BINDING, &vao);
            glGetIntegerv(GL_ACTIVE_TEXTURE, &activeTexture);
            glActiveTexture(GL_TEXTURE0);
            glGetIntegerv(GL_TEXTURE_BINDING_2D, &texture);
            glGetIntegerv(GL_SAMPLER_BINDING, &sampler);
            glActiveTexture(activeTexture);
            glGetIntegerv(GL_PIXEL_PACK_BUFFER_BINDING, &packBuffer);
            glGetIntegerv(GL_PIXEL_UNPACK_BUFFER_BINDING, &unpackBuffer);
            glGetIntegerv(GL_PACK_ALIGNMENT, &packAlignment);
            glGetIntegerv(GL_PACK_ROW_LENGTH, &packRowLength);
            glGetIntegerv(GL_PACK_SKIP_ROWS, &packSkipRows);
            glGetIntegerv(GL_PACK_SKIP_PIXELS, &packSkipPixels);
            glGetBooleanv(GL_COLOR_WRITEMASK, colorMask);
            for (size_t i = 0; i < std::size(Capabilities); ++i) {
                enabled[i] = glIsEnabled(Capabilities[i]);
            }
        }

        ~State() {
            glBindFramebuffer(GL_READ_FRAMEBUFFER, readFb);
            glBindFramebuffer(GL_DRAW_FRAMEBUFFER, drawFb);
            glViewport(viewport[0], viewport[1], viewport[2], viewport[3]);
            glUseProgram(program);
            glBindVertexArray(vao);
            glActiveTexture(GL_TEXTURE0);
            glBindTexture(GL_TEXTURE_2D, texture);
            glBindSampler(0, sampler);
            glActiveTexture(activeTexture);
            glBindBuffer(GL_PIXEL_PACK_BUFFER, packBuffer);
            glBindBuffer(GL_PIXEL_UNPACK_BUFFER, unpackBuffer);
            glPixelStorei(GL_PACK_ALIGNMENT, packAlignment);
            glPixelStorei(GL_PACK_ROW_LENGTH, packRowLength);
            glPixelStorei(GL_PACK_SKIP_ROWS, packSkipRows);
            glPixelStorei(GL_PACK_SKIP_PIXELS, packSkipPixels);
            glColorMask(colorMask[0], colorMask[1], colorMask[2], colorMask[3]);
            for (size_t i = 0; i < std::size(Capabilities); ++i) {
                if (enabled[i]) {
                    glEnable(Capabilities[i]);
                } else {
                    glDisable(Capabilities[i]);
                }
            }
        }
    };

    bool Error(const char* message) {
        if (!mReportedError) {
            std::fprintf(stderr, "WebGL depth readback: %s\n", message);
            mReportedError = true;
        }
        return false;
    }

    GLuint Compile(GLenum type, const char* source) {
        GLuint shader = glCreateShader(type);
        glShaderSource(shader, 1, &source, nullptr);
        glCompileShader(shader);
        GLint compiled;
        glGetShaderiv(shader, GL_COMPILE_STATUS, &compiled);
        if (!compiled) {
            char log[1024] = {};
            glGetShaderInfoLog(shader, sizeof(log), nullptr, log);
            Error(log);
            glDeleteShader(shader);
            return 0;
        }
        return shader;
    }

    bool Initialize() {
        if (mProgram) {
            return mMaxTextureSize > 0;
        }
        if (mReportedError) {
            return false;
        }
        constexpr const char* vertex = R"(#version 300 es
void main() {
    vec2 position = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
    gl_Position = vec4(position * 2.0 - 1.0, 0.0, 1.0);
})";
        constexpr const char* fragment = R"(#version 300 es
precision highp float;
precision highp int;
uniform highp sampler2D depthPixels;
uniform ivec2 sourcePixel;
out vec4 color;
void main() {
    float depth = texelFetch(depthPixels, sourcePixel, 0).r;
    uint nativeDepth = (uint(round(clamp(depth, 0.0, 1.0) * 16777215.0)) >> 10u) << 2u;
    color = vec4(float(nativeDepth >> 8u) / 255.0, float(nativeDepth & 255u) / 255.0, 0.0, 1.0);
})";
        GLuint vs = Compile(GL_VERTEX_SHADER, vertex);
        GLuint fs = Compile(GL_FRAGMENT_SHADER, fragment);
        if (!vs || !fs) {
            glDeleteShader(vs);
            glDeleteShader(fs);
            return false;
        }
        GLuint program = glCreateProgram();
        glAttachShader(program, vs);
        glAttachShader(program, fs);
        glLinkProgram(program);
        glDeleteShader(vs);
        glDeleteShader(fs);
        GLint linked;
        glGetProgramiv(program, GL_LINK_STATUS, &linked);
        if (!linked) {
            char log[1024] = {};
            glGetProgramInfoLog(program, sizeof(log), nullptr, log);
            glDeleteProgram(program);
            return Error(log);
        }
        mProgram = program;
        glUseProgram(mProgram);
        glUniform1i(glGetUniformLocation(mProgram, "depthPixels"), 0);
        mPixelLocation = glGetUniformLocation(mProgram, "sourcePixel");
        glGenVertexArrays(1, &mVao);
        glGenTextures(1, &mDepthTexture);
        glGenTextures(1, &mColorTexture);
        glGenFramebuffers(1, &mDepthFb);
        glGenFramebuffers(1, &mColorFb);
        glGetIntegerv(GL_MAX_TEXTURE_SIZE, &mMaxTextureSize);
        return mMaxTextureSize > 0 || Error("invalid texture size limit");
    }

    bool Allocate(int count, int width, int height) {
        if (width <= 0 || height <= 0 || width > mMaxTextureSize || height > mMaxTextureSize) {
            return Error("invalid source framebuffer dimensions");
        }
        if (count <= mCapacity && width == mWidth && height == mHeight) {
            return true;
        }
        glBindTexture(GL_TEXTURE_2D, mDepthTexture);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_COMPARE_MODE, GL_NONE);
        glTexImage2D(GL_TEXTURE_2D, 0, GL_DEPTH24_STENCIL8, width, height, 0, GL_DEPTH_STENCIL, GL_UNSIGNED_INT_24_8,
                     nullptr);
        glBindFramebuffer(GL_FRAMEBUFFER, mDepthFb);
        glFramebufferTexture2D(GL_FRAMEBUFFER, GL_DEPTH_STENCIL_ATTACHMENT, GL_TEXTURE_2D, mDepthTexture, 0);
        const GLenum none = GL_NONE;
        glDrawBuffers(1, &none);
        glReadBuffer(GL_NONE);
        if (glCheckFramebufferStatus(GL_FRAMEBUFFER) != GL_FRAMEBUFFER_COMPLETE) {
            return Error("incomplete depth copy framebuffer");
        }
        glBindTexture(GL_TEXTURE_2D, mColorTexture);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
        glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, count, 1, 0, GL_RGBA, GL_UNSIGNED_BYTE, nullptr);
        glBindFramebuffer(GL_FRAMEBUFFER, mColorFb);
        glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, mColorTexture, 0);
        if (glCheckFramebufferStatus(GL_FRAMEBUFFER) != GL_FRAMEBUFFER_COMPLETE) {
            return Error("incomplete depth encoding framebuffer");
        }
        mCapacity = count;
        mWidth = width;
        mHeight = height;
        return true;
    }

    GLuint mProgram = 0, mVao = 0, mDepthTexture = 0, mColorTexture = 0, mDepthFb = 0, mColorFb = 0;
    int mCapacity = 0, mMaxTextureSize = 0;
    int mWidth = 0, mHeight = 0;
    GLint mPixelLocation = -1;
    bool mReportedError = false;
    std::vector<uint8_t> mPixels;
};

} // namespace ShipWeb
