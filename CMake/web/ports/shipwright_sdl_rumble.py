"""SDL2 Emscripten joystick backend with browser rumble hooks.

Only this project's backend object is replaced. The SDK's SDL source/archive stay
unchanged, and its other drivers and controller mappings remain authoritative.
The SDL dependency links after this archive, so its stock backend is not extracted.
"""
import hashlib
import os

from tools.ports import get_port_by_name

deps = ['sdl2']
LICENSE = 'zlib'


def backend_source(source):
    replacements = {
        '#include "../../SDL_internal.h"': '#include "SDL_internal.h"\n#include <emscripten.h>',
        '#include "../SDL_joystick_c.h"': '#include "SDL_joystick_c.h"',
        '''static int EMSCRIPTEN_JoystickRumble(SDL_Joystick *joystick, Uint16 low_frequency_rumble, Uint16 high_frequency_rumble)
{
    return SDL_Unsupported();
}''': '''static int EMSCRIPTEN_JoystickRumble(SDL_Joystick *joystick, Uint16 low_frequency_rumble, Uint16 high_frequency_rumble)
{
    SDL_joylist_item *item = (SDL_joylist_item *)joystick->hwdata;
    if (item && EM_ASM_INT({
        return Module.webControllerRumble ? Module.webControllerRumble($0, $1, $2) : 0;
    }, item->index, low_frequency_rumble, high_frequency_rumble)) {
        return 0;
    }
    return SDL_Unsupported();
}''',
        '''static Uint32 EMSCRIPTEN_JoystickGetCapabilities(SDL_Joystick *joystick)
{
    return 0;
}''': '''static Uint32 EMSCRIPTEN_JoystickGetCapabilities(SDL_Joystick *joystick)
{
    SDL_joylist_item *item = (SDL_joylist_item *)joystick->hwdata;
    if (item && EM_ASM_INT({
        return Module.webControllerSupportsRumble ? Module.webControllerSupportsRumble($0) : 0;
    }, item->index)) {
        return SDL_JOYCAP_RUMBLE;
    }
    return 0;
}''',
    }
    for before, after in replacements.items():
        if source.count(before) != 1:
            raise RuntimeError('SDL2 joystick backend changed; review the browser rumble adapter')
        source = source.replace(before, after)
    source += '''
#ifdef SDL_JOYSTICK_EMSCRIPTEN
EMSCRIPTEN_KEEPALIVE void Shipwright_WebStopControllerRumble(int browser_index)
{
    SDL_joylist_item *item = JoystickByIndex(browser_index);
    if (item && item->joystick) {
        SDL_JoystickRumble(item->joystick, 0, 0, 0);
    }
}
#endif
'''
    return '/* Modified for Shipwright: browser rumble/capabilities hooks. SDK sources are unchanged. */\n' + source


def get(ports, settings, shared):
    sdl = get_port_by_name('sdl2')
    if sdl.VERSION != '2.32.10':
        raise RuntimeError('Browser rumble adapter requires reviewed SDL2 port version 2.32.10')
    source_dir = ports.get_dir('sdl2', sdl.SUBDIR)
    with open(os.path.join(source_dir, 'src/joystick/emscripten/SDL_sysjoystick.c'), encoding='utf-8') as stream:
        source = backend_source(stream.read())
    digest = hashlib.sha256(source.encode()).hexdigest()[:16]
    library = f'libshipwright-sdl-rumble-{digest}' + ('-mt' if settings.PTHREADS else '') + '.a'

    def create(final):
        work_dir = ports.get_dir('shipwright_sdl_rumble', digest)
        os.makedirs(work_dir, exist_ok=True)
        filename = os.path.join(work_dir, 'SDL_sysjoystick.c')
        ports.write_file(filename, source)
        includes = [ports.get_include_dir('SDL2'), os.path.join(source_dir, 'src'),
                    os.path.join(source_dir, 'src/joystick'), os.path.join(source_dir, 'src/joystick/emscripten')]
        flags = ['-pthread'] if settings.PTHREADS else []
        ports.build_port(work_dir, final, 'shipwright_sdl_rumble', srcs=[filename], includes=includes, flags=flags)

    return [shared.cache.get_lib(library, create, what='port')]


def clear(ports, settings, shared):
    # Content-addressed libraries never reuse an object from a different adapter.
    pass


def show():
    return 'Shipwright SDL2 browser rumble backend (zlib license; SDL2 dependency)'
