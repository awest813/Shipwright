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
#ifdef __EMSCRIPTEN__
#include <emscripten.h>
#endif
extern "C" {
#include "variables.h"
#include "macros.h"
}

static bool captured = false;

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

void RenderAuditCapture(const std::shared_ptr<Fast::Interpreter>& interpreter, float interpolation) {
    if (!RenderAuditWantsFrame() || interpolation != 1.0f)
        return;
    if (!interpreter || !interpreter->mRapi || !GET_PLAYER(gPlayState))
        return;
    captured = true;
    const uint32_t targetFrame = static_cast<uint32_t>(CVarGetInteger(CVAR_DEVELOPER_TOOLS("RenderAudit.Frame"), 60));
    const int expectedScene = CVarGetInteger(CVAR_DEVELOPER_TOOLS("RenderAudit.Scene"), -1);
    const std::string label = CVarGetString(CVAR_DEVELOPER_TOOLS("RenderAudit.Label"), "capture");
    if (label.empty() || label.size() > 80 ||
        label.find_first_not_of("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-") !=
            std::string::npos) {
        SPDLOG_ERROR("Render audit label must contain only letters, numbers, underscores or hyphens");
        return;
    }
    nlohmann::json result = { { "format", "shipwright-render-capture" },
                              { "version", 1 },
                              { "label", label },
                              { "buildVersion", std::string(gBuildVersion) },
                              { "gitCommit", std::string(gGitCommitHash) },
                              { "scene", gPlayState->sceneNum },
                              { "frame", gPlayState->gameplayFrames },
                              { "targetFrame", targetFrame },
                              { "seed", CVarGetInteger(CVAR_DEVELOPER_TOOLS("RenderAudit.Seed"), 12345) },
                              { "interpolation", interpolation },
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
    result["room"] = gPlayState->roomCtx.curRoom.num;
    result["settings"] = { { "textureFilter", CVarGetInteger(CVAR_TEXTURE_FILTER, 0) },
                           { "alternateAssets", CVarGetInteger(CVAR_SETTING("AltAssets"), 1) } };
    std::string error;
    if (gPlayState->gameplayFrames != targetFrame)
        error = "missed target simulation frame";
    else if (expectedScene >= 0 && gPlayState->sceneNum != expectedScene)
        error = "unexpected scene";
    else if (!interpreter->mRendersToFb || interpreter->mMsaaLevel > 1)
        error = "requires an offscreen, single-sample game framebuffer";
    else if (interpreter->mCurDimensions.width != 320 || interpreter->mCurDimensions.height != 240)
        error = "requires N64 resolution mode (320 x 240)";
    if (error.empty()) {
        std::vector<uint16_t> pixels(320 * 240);
        interpreter->mRapi->ReadFramebufferToCPU(interpreter->mGameFb, 320, 240, pixels.data());
        // This single-sample game FBO has opengl_invertY=true: GL's bottom row
        // contains the game's top row, matching DX11/Metal's top-down readback.
        auto image = nlohmann::json::array();
        for (int y = 0; y < 240; y++) {
            for (int x = 0; x < 320; x++)
                image.push_back(pixels[y * 320 + x] >> 1);
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
