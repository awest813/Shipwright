#pragma once

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
