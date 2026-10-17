// Checks the Web Speech synthesizer against a fake speechSynthesis
// (web-speech.test.pre.js). Build and run: see the build-web job in
// .github/workflows/generate-builds.yml.
#include "soh/Enhancements/speechsynthesizer/WebSpeechSynthesizer.h"

#include <emscripten.h>

int main() {
  WebSpeechSynthesizer speech;
  if (!speech.Init()) {
    return 1;
  }
  speech.Speak("Grüße aus Hyrule – Ganondorf!", "de-DE");
  speech.Speak("Hey! Listen!", "en-US");
  speech.Speak("Bienvenue", "fr-FR");
  speech.Uninitialize();
  speech.Speak("not spoken after uninitializing", "en-US");
  return EM_ASM_INT({ return Module.checkSpeech(); });
}
