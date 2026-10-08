#pragma once

#ifdef __cplusplus
#include <memory>
#include <string>

namespace Fast {
class Interpreter;
}

// Opt-in diagnostic captures. Normal gameplay never enables these CVars.
bool RenderAuditWantsFrame();
float RenderAuditTargetInterpolation();
void RenderAuditCapture(const std::shared_ptr<Fast::Interpreter>& interpreter, float interpolation);
void RenderAuditRecordPopup(const std::string& title, const std::string& message);

extern "C" {
#endif
// Capture values already computed by Lights_GlowCheck, without additional GPU queries.
int RenderAuditBeginGlowCheck(unsigned int frame);
void RenderAuditRecordGlowDepth(int worldX, int worldY, int worldZ, float pixelX, float pixelY, float clipDepth,
                               int lightDepth, int bufferDepth, int checked, int drawGlow);
#ifdef __cplusplus
}
#endif
