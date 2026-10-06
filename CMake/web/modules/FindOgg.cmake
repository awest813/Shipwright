# Emscripten build: provided by the emscripten port (-sUSE_OGG=1), no library search needed.
if(NOT TARGET Ogg::ogg)
    add_library(Ogg::ogg INTERFACE IMPORTED GLOBAL)
    set_target_properties(Ogg::ogg PROPERTIES INTERFACE_COMPILE_OPTIONS "-sUSE_OGG=1" INTERFACE_LINK_OPTIONS "-sUSE_OGG=1")
endif()
set(Ogg_FOUND TRUE)
set(Ogg_INCLUDE_DIRS "")
set(Ogg_LIBRARIES "")
