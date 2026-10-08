#include "RuntimeDiagnostics.h"
#include <cassert>
#include <cstdio>
#include <cstdlib>
#include <cstring>

static void CheckTiming() {
    const auto diagnostics = Web::CaptureRuntimeDiagnostics();
    assert(diagnostics.mainLoopMode == EM_TIMING_SETTIMEOUT);
    assert(diagnostics.mainLoopTimingValue > 0);
    printf("Timing query passed: mode=%d value=%d\n", diagnostics.mainLoopMode, diagnostics.mainLoopTimingValue);
    emscripten_cancel_main_loop();
    emscripten_force_exit(0);
}

int main() {
    constexpr size_t size = 32 * 1024 * 1024;
    const auto before = Web::CaptureRuntimeDiagnostics();
    void* allocation = malloc(size);
    assert(allocation != nullptr);
    memset(allocation, 0x5a, size);
    assert(static_cast<volatile unsigned char*>(allocation)[size - 1] == 0x5a);
    const auto allocated = Web::CaptureRuntimeDiagnostics();
    assert(allocated.allocatorUsedBytes >= before.allocatorUsedBytes + size);
    assert(allocated.wasmMemoryBytes > before.wasmMemoryBytes);
    assert(allocated.allocatorUsedBytes <= allocated.wasmMemoryBytes);
    free(allocation);
    const auto released = Web::CaptureRuntimeDiagnostics();
    assert(released.allocatorUsedBytes < allocated.allocatorUsedBytes);
    assert(released.allocatorFreeBytes > allocated.allocatorFreeBytes);
    assert(released.wasmMemoryBytes == allocated.wasmMemoryBytes);
    printf("Memory query passed: before=%zu allocated=%zu released=%zu used=%zu\n", before.wasmMemoryBytes,
           allocated.wasmMemoryBytes, released.wasmMemoryBytes, released.allocatorUsedBytes);
    emscripten_set_main_loop(CheckTiming, 60, false);
}
