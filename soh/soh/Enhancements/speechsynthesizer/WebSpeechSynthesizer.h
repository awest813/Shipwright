#pragma once

#include "SpeechSynthesizer.h"

// Text to speech in the browser, through the Web Speech API (speechSynthesis).
class WebSpeechSynthesizer : public SpeechSynthesizer {
  public:
    WebSpeechSynthesizer();

    void Speak(const char* text, const char* language);

  protected:
    bool DoInit(void);
    void DoUninitialize(void);
};
