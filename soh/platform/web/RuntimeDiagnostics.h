#pragma once

#include <malloc.h>
#include <emscripten.h>
#include <emscripten/heap.h>

namespace Web {
struct RuntimeDiagnostics {
    size_t wasmMemoryBytes;
    size_t allocatorUsedBytes;
    size_t allocatorFreeBytes;
    int mainLoopMode;
    int mainLoopTimingValue;
};

inline RuntimeDiagnostics CaptureRuntimeDiagnostics() {
    int mode = -1;
    int value = 0;
    emscripten_get_main_loop_timing(&mode, &value);
    const auto allocation = mallinfo();
    return { emscripten_get_heap_size(), allocation.uordblks, allocation.fordblks, mode, value };
}
} // namespace Web
