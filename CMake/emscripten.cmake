# Web (Emscripten / WebAssembly) build configuration. See docs/WEB_PORT.md.
#
# Included from the root CMakeLists.txt when configured with emcmake. Everything that differs
# from the desktop builds is kept here, or behind if(EMSCRIPTEN) next to the code it replaces.

message(STATUS "Configuring the web (Emscripten) build")

# Emscripten ports stand in for the system libraries. The Find modules in CMake/web/modules
# turn find_package() into interface targets carrying the matching -sUSE_* flag.
list(PREPEND CMAKE_MODULE_PATH ${CMAKE_CURRENT_LIST_DIR}/web/modules)

# Exceptions are used throughout soh, libultraship, torch, yaml-cpp and nlohmann_json. These go
# through add_compile_options rather than CMAKE_CXX_FLAGS because torch overwrites the latter.
add_compile_options(-fwasm-exceptions)
add_link_options(-fwasm-exceptions)

# Standard SIMD enables LLVM's vectorizer without relaxing the root project's
# floating-point rules. Keep a scalar build available for fidelity/performance comparisons.
option(SOH_WEB_SIMD "Enable standard WebAssembly SIMD instructions" ON)
if(SOH_WEB_SIMD)
    add_compile_options(-msimd128)
    add_link_options(-msimd128)
endif()

# Several targets (ImGui among them) include SDL headers without linking an SDL target, and
# emscripten's placeholder SDL headers error out unless the port flag is present.
add_compile_options(-sUSE_SDL=2)
add_link_options("--use-port=${CMAKE_CURRENT_LIST_DIR}/web/ports/shipwright_sdl_rumble.py")

# libultraship: WebGL2 is GLES 3.0, so use the GLES renderer path and ImGui's ES3 backend.
set(USE_OPENGLES ON CACHE BOOL "" FORCE)
add_compile_definitions(IMGUI_IMPL_OPENGL_ES3)

# Runtime C scripting compiles native code with TinyCC, which cannot work in a browser.
set(ENABLE_SCRIPTING OFF CACHE BOOL "" FORCE)

# soh.o2r is made by soh-o2r-packer, which would be built for wasm here and can't run on the
# build machine. Build it natively (SOH_TOOLS_ONLY=ON + GenerateSohOtr) and point at it.
set(SOH_PREBUILT_O2R "" CACHE FILEPATH "Natively built soh.o2r to package with the web build")

include(FetchContent)

#=================== nlohmann_json ===================
FetchContent_Declare(
    nlohmann_json
    GIT_REPOSITORY https://github.com/nlohmann/json.git
    GIT_TAG v3.12.0
    GIT_SHALLOW TRUE
    OVERRIDE_FIND_PACKAGE
)
FetchContent_MakeAvailable(nlohmann_json)

#=================== libzip ===================
set(CMAKE_POLICY_DEFAULT_CMP0077 NEW)
set(BUILD_TOOLS OFF)
set(BUILD_REGRESS OFF)
set(BUILD_EXAMPLES OFF)
set(BUILD_DOC OFF)
set(BUILD_OSSFUZZ OFF)
set(BUILD_SHARED_LIBS OFF)
set(ENABLE_COMMONCRYPTO OFF)
set(ENABLE_GNUTLS OFF)
set(ENABLE_MBEDTLS OFF)
set(ENABLE_OPENSSL OFF)
set(ENABLE_WINDOWS_CRYPTO OFF)
set(ENABLE_BZIP2 OFF)
set(ENABLE_LZMA OFF)
set(ENABLE_ZSTD OFF)
FetchContent_Declare(
    libzip
    GIT_REPOSITORY https://github.com/nih-at/libzip.git
    GIT_TAG v1.11.4
    GIT_SHALLOW TRUE
    OVERRIDE_FIND_PACKAGE
)
FetchContent_MakeAvailable(libzip)

#=================== Opus / OpusFile ===================
set(OPUS_BUILD_TESTING OFF)
set(OPUS_BUILD_PROGRAMS OFF)
set(OPUS_INSTALL_PKG_CONFIG_MODULE OFF)
set(OPUS_INSTALL_CMAKE_CONFIG_MODULE OFF)
FetchContent_Declare(
    Opus
    GIT_REPOSITORY https://github.com/xiph/opus.git
    GIT_TAG v1.5.2
    GIT_SHALLOW TRUE
    OVERRIDE_FIND_PACKAGE
)
FetchContent_MakeAvailable(Opus)

# opusfile 0.12 has no CMake build, so build its sources directly (without the HTTP backend).
FetchContent_Declare(
    OpusFile
    GIT_REPOSITORY https://github.com/xiph/opusfile.git
    GIT_TAG v0.12
    GIT_SHALLOW TRUE
)
FetchContent_MakeAvailable(OpusFile)
add_library(opusfile STATIC
    ${opusfile_SOURCE_DIR}/src/info.c
    ${opusfile_SOURCE_DIR}/src/internal.c
    ${opusfile_SOURCE_DIR}/src/opusfile.c
    ${opusfile_SOURCE_DIR}/src/stream.c
)
target_include_directories(opusfile PUBLIC ${opusfile_SOURCE_DIR}/include)
target_compile_options(opusfile PRIVATE -sUSE_OGG=1 -w)
target_link_libraries(opusfile PUBLIC opus)
target_link_options(opusfile INTERFACE -sUSE_OGG=1)

#=================== libultraship / torch patches ===================
# Web support for the submodules lives in CMake/web/patches until it is upstreamed. Apply each
# patch once; a patch that already reverse-applies is treated as applied.
find_package(Git REQUIRED)
foreach(_submodule libultraship torch)
    file(GLOB _patches ${CMAKE_CURRENT_LIST_DIR}/web/patches/${_submodule}/*.patch)
    foreach(_patch IN LISTS _patches)
        execute_process(
            COMMAND ${GIT_EXECUTABLE} apply --reverse --check ${_patch}
            WORKING_DIRECTORY ${CMAKE_SOURCE_DIR}/${_submodule}
            RESULT_VARIABLE _already_applied
            OUTPUT_QUIET ERROR_QUIET
        )
        if(NOT _already_applied EQUAL 0)
            execute_process(
                COMMAND ${GIT_EXECUTABLE} apply ${_patch}
                WORKING_DIRECTORY ${CMAKE_SOURCE_DIR}/${_submodule}
                RESULT_VARIABLE _apply_result
            )
            if(NOT _apply_result EQUAL 0)
                message(FATAL_ERROR "Failed to apply ${_patch} to ${_submodule}")
            endif()
            message(STATUS "Applied ${_submodule} web patch: ${_patch}")
        endif()
    endforeach()
endforeach()
