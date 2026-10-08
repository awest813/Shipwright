#pragma once

#include <memory>

namespace Fast {
class Interpreter;
}

// Opt-in diagnostic captures. Normal gameplay never enables these CVars.
bool RenderAuditWantsFrame();
void RenderAuditCapture(const std::shared_ptr<Fast::Interpreter>& interpreter, float interpolation);
