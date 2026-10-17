// A stand-in for the browser's speechSynthesis that records what the synthesizer asks for.
const events = [];
globalThis.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
globalThis.speechSynthesis = {
  getVoices: () => [{ lang: "en-GB", name: "British", localService: true }, { lang: "de-DE", name: "Remote German", localService: false },
                    { lang: "de-DE", name: "Local German", localService: true }, { lang: "fr-CA", name: "Canadian French", localService: true }],
  speak: utterance => events.push(["speak", utterance.text, utterance.lang, utterance.voice && utterance.voice.name]),
  cancel: () => events.push(["cancel"]),
};
Module.checkSpeech = () => {
  const expected = JSON.stringify([
    ["cancel"], ["speak", "Grüße aus Hyrule – Ganondorf!", "de-DE", "Local German"],
    ["cancel"], ["speak", "Hey! Listen!", "en-US", "British"],
    ["cancel"], ["speak", "Bienvenue", "fr-FR", "Canadian French"],
    ["cancel"],
  ]);
  const actual = JSON.stringify(events);
  if (actual !== expected) { console.error(`FAIL: web speech\n expected ${expected}\n actual   ${actual}`); return 1; }
  console.log("PASS: web speech synthesizer");
  return 0;
};
