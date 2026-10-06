# Emscripten build: provided by the emscripten port (-sUSE_BZIP2=1), no library search needed.
if(NOT TARGET BZip2::BZip2)
    add_library(BZip2::BZip2 INTERFACE IMPORTED GLOBAL)
    set_target_properties(BZip2::BZip2 PROPERTIES INTERFACE_COMPILE_OPTIONS "-sUSE_BZIP2=1" INTERFACE_LINK_OPTIONS "-sUSE_BZIP2=1")
endif()
set(BZIP2_FOUND TRUE)
set(BZIP2_INCLUDE_DIRS "")
set(BZIP2_LIBRARIES "")
set(BZip2_FOUND TRUE)
