#include "RenderAudit.h"

#include "soh/cvar_prefixes.h"
#include "soh/Enhancements/gameconsole.h"
#include <fast/interpreter.h>
#include <libultraship/bridge/consolevariablebridge.h>
#include <ship/Context.h>
#include <ship/window/Window.h>
#include <nlohmann/json.hpp>
#include <spdlog/spdlog.h>
#include <filesystem>
#include <fstream>
#include <vector>
#include <algorithm>
#include <cmath>
#ifdef __EMSCRIPTEN__
#include <emscripten.h>
#endif
extern "C" {
#include "variables.h"
#include "macros.h"
}

static bool captured = false;
static nlohmann::json glowDepthChecks = nlohmann::json::array();
static nlohmann::json glowDepthPresentation;
static unsigned int lastPresentedFrame = 0;
static float lastPresentedInterpolation = 0.0f;

extern "C" int RenderAuditBeginGlowCheck(unsigned int frame) {
    if (!CVarGetInteger(CVAR_DEVELOPER_TOOLS("RenderAudit.Enabled"), 0))
        return 0;
    glowDepthChecks.clear();
    glowDepthPresentation = { { "simulationFrame", frame },
                              { "previousPresentedFrame", lastPresentedFrame },
                              { "previousInterpolation", lastPresentedInterpolation } };
    return 1;
}

extern "C" void RenderAuditRecordGlowDepth(int worldX, int worldY, int worldZ, float pixelX, float pixelY,
                                           float clipDepth, int lightDepth, int bufferDepth, int checked,
                                           int drawGlow) {
    if (glowDepthChecks.size() >= 32)
        return;
    glowDepthChecks.push_back({ { "position", { worldX, worldY, worldZ } },
                                { "pixel", { pixelX, pixelY } },
                                { "clipDepth", clipDepth },
                                { "lightDepth", lightDepth },
                                { "bufferDepth", bufferDepth },
                                { "checked", checked != 0 },
                                { "drawGlow", drawGlow != 0 } });
}

void RenderAuditRecordPopup(const std::string& title, const std::string& message) {
    if (!CVarGetInteger(CVAR_DEVELOPER_TOOLS("RenderAudit.Enabled"), 0))
        return;
    const std::filesystem::path path = Ship::Context::GetPathRelativeToAppDirectory("RenderAudit/startup.log");
    std::error_code error;
    std::filesystem::create_directories(path.parent_path(), error);
    if (error)
        return;
    std::ofstream output(path, std::ios::app);
    output << title << '\n' << message << "\n\n";
}

bool RenderAuditWantsFrame() {
    if (captured || !CVarGetInteger(CVAR_DEVELOPER_TOOLS("RenderAudit.Enabled"), 0))
        return false;
    const int targetFrame = CVarGetInteger(CVAR_DEVELOPER_TOOLS("RenderAudit.Frame"), 60);
    return targetFrame > 0 && gPlayState != nullptr && gSaveContext.gameMode == GAMEMODE_NORMAL &&
           gPlayState->gameplayFrames >= static_cast<uint32_t>(targetFrame);
}

float RenderAuditTargetInterpolation() {
    const int step = CVarGetInteger(CVAR_DEVELOPER_TOOLS("RenderAudit.InterpolationStep"), 3);
    return static_cast<float>(std::clamp(step, 1, 3)) / 3.0f;
}

void RenderAuditCapture(const std::shared_ptr<Fast::Interpreter>& interpreter, float interpolation) {
    if (captured || !CVarGetInteger(CVAR_DEVELOPER_TOOLS("RenderAudit.Enabled"), 0))
        return;
    if (gPlayState != nullptr) {
        lastPresentedFrame = gPlayState->gameplayFrames;
        lastPresentedInterpolation = interpolation;
    }
    if (!RenderAuditWantsFrame())
        return;
    if (!interpreter || !interpreter->mRapi || !GET_PLAYER(gPlayState))
        return;
    const uint32_t targetFrame = static_cast<uint32_t>(CVarGetInteger(CVAR_DEVELOPER_TOOLS("RenderAudit.Frame"), 60));
    const float targetInterpolation = RenderAuditTargetInterpolation();
    const int targetWidth = CVarGetInteger(CVAR_DEVELOPER_TOOLS("RenderAudit.Width"), 320);
    const int targetHeight = CVarGetInteger(CVAR_DEVELOPER_TOOLS("RenderAudit.Height"), 240);
    if (gPlayState->gameplayFrames == targetFrame && std::abs(interpolation - targetInterpolation) > 0.000001f)
        return;
    captured = true;
    const int expectedScene = CVarGetInteger(CVAR_DEVELOPER_TOOLS("RenderAudit.Scene"), -1);
    const std::string label = CVarGetString(CVAR_DEVELOPER_TOOLS("RenderAudit.Label"), "capture");
    if (label.empty() || label.size() > 80 ||
        label.find_first_not_of("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-") !=
            std::string::npos) {
        SPDLOG_ERROR("Render audit label must contain only letters, numbers, underscores or hyphens");
        return;
    }
    nlohmann::json result = { { "format", "shipwright-render-capture" },
                              { "version", 3 },
                              { "label", label },
                              { "buildVersion", std::string(gBuildVersion) },
                              { "gitCommit", std::string(gGitCommitHash) },
                              { "scene", gPlayState->sceneNum },
                              { "frame", gPlayState->gameplayFrames },
                              { "targetFrame", targetFrame },
                              { "seed", CVarGetInteger(CVAR_DEVELOPER_TOOLS("RenderAudit.Seed"), 12345) },
                              { "interpolation", interpolation },
                              { "targetInterpolation", targetInterpolation },
                              { "targetWidth", targetWidth },
                              { "targetHeight", targetHeight },
                              { "entrance", gSaveContext.entranceIndex },
                              { "age", gSaveContext.linkAge },
                              { "dayTime", gSaveContext.dayTime },
                              { "health", gSaveContext.health },
                              { "backend", interpreter->mRapi->GetName() },
                              { "pixelFormat", "rgb555-top-down" },
                              { "width", interpreter->mCurDimensions.width },
                              { "height", interpreter->mCurDimensions.height } };
    const auto* player = GET_PLAYER(gPlayState);
    result["player"] = { { "position",
                           { player->actor.world.pos.x, player->actor.world.pos.y, player->actor.world.pos.z } },
                         { "yaw", player->actor.shape.rot.y },
                         { "animationFrame", player->skelAnime.curFrame } };
    const auto* camera = gPlayState->cameraPtrs[gPlayState->activeCamera];
    result["camera"] = { { "eye", { camera->eye.x, camera->eye.y, camera->eye.z } },
                         { "at", { camera->at.x, camera->at.y, camera->at.z } },
                         { "fov", camera->fov } };
    // Record the engine's glow decision without issuing extra depth queries or changing the frame.
    // These backend-dependent diagnostics are deliberately outside matched simulation-state metadata.
    auto glowLights = nlohmann::json::array();
    for (const auto* node = gPlayState->lightCtx.listHead; node != nullptr; node = node->next) {
        if (node->info->type != LIGHT_POINT_GLOW)
            continue;
        const auto& point = node->info->params.point;
        glowLights.push_back({ { "position", { point.x, point.y, point.z } },
                               { "color", { point.color[0], point.color[1], point.color[2] } },
                               { "radius", point.radius },
                               { "drawGlow", point.drawGlow != 0 } });
    }
    result["glowLights"] = std::move(glowLights);
    result["glowDepthChecks"] = glowDepthChecks;
    result["glowDepthPresentation"] = glowDepthPresentation;
    result["room"] = gPlayState->roomCtx.curRoom.num;
    result["settings"] = { { "textureFilter", CVarGetInteger(CVAR_TEXTURE_FILTER, 0) },
                           { "alternateAssets", CVarGetInteger(CVAR_SETTING("AltAssets"), 1) } };
    std::string error;
    const int targetStep = CVarGetInteger(CVAR_DEVELOPER_TOOLS("RenderAudit.InterpolationStep"), 3);
    if (targetWidth < 320 || targetWidth > 1920 || targetHeight < 240 || targetHeight > 1080)
        error = "capture dimensions must be within 320 x 240 and 1920 x 1080";
    else if (targetStep < 1 || targetStep > 3)
        error = "interpolation step must be 1, 2 or 3";
    else if (gPlayState->gameplayFrames != targetFrame)
        error = "missed target simulation frame";
    else if (expectedScene >= 0 && gPlayState->sceneNum != expectedScene)
        error = "unexpected scene";
    else if (!interpreter->mRendersToFb || interpreter->mMsaaLevel > 1)
        error = "requires an offscreen, single-sample game framebuffer";
    else if (interpreter->mCurDimensions.width != targetWidth || interpreter->mCurDimensions.height != targetHeight)
        error = "game framebuffer does not match the requested capture resolution";
    if (error.empty()) {
        std::vector<uint16_t> pixels(static_cast<size_t>(targetWidth) * targetHeight);
        interpreter->mRapi->ReadFramebufferToCPU(interpreter->mGameFb, targetWidth, targetHeight, pixels.data());
        // This single-sample game FBO has opengl_invertY=true: GL's bottom row
        // contains the game's top row, matching DX11/Metal's top-down readback.
        auto image = nlohmann::json::array();
        for (int y = 0; y < targetHeight; y++) {
            for (int x = 0; x < targetWidth; x++)
                image.push_back(pixels[y * targetWidth + x] >> 1);
        }
        result["pixels"] = std::move(image);
        result["reason"] = "captured";
    } else {
        result["reason"] = error;
        SPDLOG_ERROR("Render audit: {}", error);
    }
    const std::string relativePath = "RenderAudit/" + label + ".json";
    const std::string path = Ship::Context::GetPathRelativeToAppDirectory(relativePath.c_str());
    std::filesystem::create_directories(std::filesystem::path(path).parent_path());
    std::ofstream output(path);
    output << result.dump();
    output.close();
    if (!output) {
        SPDLOG_ERROR("Could not write render audit capture: {}", path);
        return;
    }
#ifdef __EMSCRIPTEN__
    EM_ASM(
        {
            if (Module.onRenderAuditCaptured)
                Module.onRenderAuditCaptured(UTF8ToString($0));
        },
        path.c_str());
#else
    SPDLOG_INFO("Render audit capture written: {}", path);
    if (CVarGetInteger(CVAR_DEVELOPER_TOOLS("RenderAudit.Exit"), 0))
        Ship::Context::GetRawInstance()->GetWindow()->Close();
#endif
}
