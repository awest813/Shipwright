#include "WebSpeechSynthesizer.h"

#include <emscripten.h>
#include <spdlog/spdlog.h>

EM_JS_DEPS(webspeech, "$UTF8ToString");

// clang-format would reformat the JavaScript below as C++ ("!==" into "!= =").
// clang-format off
EM_JS(int, WebSpeechAvailable, (void), {
    return typeof speechSynthesis !== "undefined" && typeof SpeechSynthesisUtterance === "function" ? 1 : 0;
});

// Like the native synthesizers, a new line interrupts the one being read. A voice for the language is
// preferred when the browser has one (they load asynchronously, so the first lines may use the default).
EM_JS(void, WebSpeechSpeak, (const char* text, const char* language), {
    const utterance = new SpeechSynthesisUtterance(UTF8ToString(text));
    const lang = UTF8ToString(language);
    utterance.lang = lang;
    const voices = speechSynthesis.getVoices();
    const voice = voices.find(v => v.lang === lang && v.localService) || voices.find(v => v.lang === lang) ||
                  voices.find(v => v.lang && v.lang.split("-")[0] === lang.split("-")[0]);
    if (voice) {
        utterance.voice = voice;
    }
    speechSynthesis.cancel();
    speechSynthesis.speak(utterance);
});

EM_JS(void, WebSpeechCancel, (void), { speechSynthesis.cancel(); });
// clang-format on

WebSpeechSynthesizer::WebSpeechSynthesizer() {
}

bool WebSpeechSynthesizer::DoInit() {
    return WebSpeechAvailable();
}

void WebSpeechSynthesizer::DoUninitialize() {
    WebSpeechCancel();
}

void WebSpeechSynthesizer::Speak(const char* text, const char* language) {
    if (!IsInitialized()) {
        SPDLOG_INFO("Spoken Text ({}): {}", language, text);
        return;
    }
    WebSpeechSpeak(text, language);
}
