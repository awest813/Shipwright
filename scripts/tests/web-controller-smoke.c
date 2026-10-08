// Headless test of the real SDL2 browser backend, including sparse indexes and hotplug.
// Compile with Emscripten and scripts/tests/web-controller-smoke.pre.js; run using Node.
#include <SDL.h>
#include <assert.h>
#include <emscripten.h>
#include <stdio.h>

extern void Shipwright_WebStopControllerRumble(int browser_index);

static SDL_GameController* open_controller(int index) {
    char guid[33], mapping[256];
    SDL_JoystickGetGUIDString(SDL_JoystickGetDeviceGUID(index), guid, sizeof(guid));
    snprintf(mapping, sizeof(mapping), "%s,Smoke,a:b0,b:b1,x:b2,y:b3,start:b9,leftx:a0,lefty:a1,", guid);
    assert(SDL_GameControllerAddMapping(mapping) >= 0);
    SDL_GameController* controller = SDL_GameControllerOpen(index);
    assert(controller);
    assert(SDL_GameControllerHasRumble(controller));
    return controller;
}

int main(void) {
    int initialized = SDL_Init(SDL_INIT_GAMECONTROLLER);
    if (initialized != 0) fprintf(stderr, "SDL initialization failed: %s\n", SDL_GetError());
    assert(initialized == 0);
    assert(SDL_NumJoysticks() == 2);
    SDL_GameController* first = open_controller(0);
    SDL_GameController* second = open_controller(1);
    assert(SDL_GameControllerRumble(first, 65535, 1234, 0) == 0);
    assert(SDL_GameControllerRumble(second, 4321, 5432, 0) == 0);
    assert(EM_ASM_INT({ return Module.rumbleCalls[0][0] === 2 && Module.rumbleCalls[1][0] === 5; }));
    assert(EM_ASM_INT({ return Module.rumbleCalls[0][1] === 65535 && Module.rumbleCalls[0][2] === 1234; }));
    Shipwright_WebStopControllerRumble(2);
    assert(EM_ASM_INT({ return Module.rumbleCalls.at(-1).every((value, i) => value === (i ? 0 : 2)); }));
    int calls_before_restart = EM_ASM_INT({ return Module.rumbleCalls.length; });
    assert(SDL_GameControllerRumble(first, 65535, 1234, 0) == 0);
    assert(EM_ASM_INT({ return Module.rumbleCalls.length; }) == calls_before_restart + 1);
    assert(SDL_GameControllerRumble(first, 0, 0, 0) == 0);
    assert(EM_ASM_INT({ return Module.rumbleCalls.at(-1).every((value, i) => value === (i ? 0 : 2)); }));

    EM_ASM({ Module.setGamepadButton(2, 0, true); });
    SDL_GameControllerUpdate();
    assert(SDL_GameControllerGetButton(first, SDL_CONTROLLER_BUTTON_A) == SDL_PRESSED);
    assert(SDL_GameControllerGetButton(second, SDL_CONTROLLER_BUTTON_A) == SDL_RELEASED);

    EM_ASM({ Module.changeGamepad(2, false); Module.changeGamepad(0, true); });
    SDL_GameControllerUpdate();
    assert(SDL_NumJoysticks() == 2);
    assert(SDL_GameControllerGetButton(first, SDL_CONTROLLER_BUTTON_A) == SDL_RELEASED);
    SDL_GameControllerClose(first);
    // SDL's list retained browser index 5 first and appended the new browser index 0.
    SDL_GameController* replacement = open_controller(1);
    assert(SDL_GameControllerRumble(replacement, 100, 200, 0) == 0);
    assert(EM_ASM_INT({ return Module.rumbleCalls.at(-1)[0] === 0; }));
    assert(SDL_GameControllerRumble(second, 99, 98, 0) == 0);
    assert(EM_ASM_INT({ return Module.rumbleCalls.at(-1)[0] === 5; }));
    SDL_GameControllerClose(replacement);
    SDL_GameControllerClose(second);
    SDL_Quit();
    puts("SDL browser controllers: sparse indexes, duplicate names, rumble stop/restart and button release on hotplug passed");
    return 0;
}
