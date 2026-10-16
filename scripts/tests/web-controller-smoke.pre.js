// Synthetic browser platform for a headless Node test; no real browser/device is controlled.
var smokeHandlers = new Map();
var window = {
  addEventListener(type, handler) { smokeHandlers.set(type, handler); },
  removeEventListener(type) { smokeHandlers.delete(type); },
};
globalThis.window = window;
var smokePads = [];
function smokePad(index) {
  return { index, connected: true, id: 'Duplicate smoke controller', mapping: 'standard',
    timestamp: 1, axes: [0, 0], buttons: Array.from({ length: 12 }, () => ({ value: 0, pressed: false })) };
}
smokePads[2] = smokePad(2); smokePads[5] = smokePad(5);
var navigator = { getGamepads: () => smokePads, languages: ['en-US'], language: 'en-US', userActivation: { isActive: true } };
Module.rumbleCalls = [];
Module.webControllerSupportsRumble = index => !!smokePads[index]?.connected;
Module.webControllerRumble = (index, low, high) => {
  Module.rumbleCalls.push([index, low, high]);
  return !!smokePads[index]?.connected;
};
Module.changeGamepad = (index, connected) => {
  const pad = connected ? smokePad(index) : smokePads[index];
  pad.connected = connected;
  smokePads[index] = connected ? pad : null;
  smokeHandlers.get(connected ? 'gamepadconnected' : 'gamepaddisconnected')({ gamepad: pad, preventDefault() {} });
};
Module.setGamepadButton = (index, button, pressed) => {
  smokePads[index].buttons[button] = { value: pressed ? 1 : 0, pressed };
  smokePads[index].timestamp++;
};
