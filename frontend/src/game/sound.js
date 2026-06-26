// game/sound.js
// Tiny WebAudio cues for game rooms — no asset files, no licensing concerns.

function tone(ctx, freq, start, dur, { type = 'sine', peak = 0.25 } = {}) {
  const osc  = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(peak, start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, start + dur);
  osc.connect(gain).connect(ctx.destination);
  osc.start(start);
  osc.stop(start + dur);
}

/** Bright ascending arpeggio — won an auction. */
export function playWinChime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [523.25, 659.25, 783.99].forEach((freq, i) => // C5, E5, G5
      tone(ctx, freq, ctx.currentTime + i * 0.1, 0.3));
    setTimeout(() => ctx.close(), 700);
  } catch { /* ignore — non-essential */ }
}

/** Short, low, muted blip — it's your turn to pick. */
export function playTurnChime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    tone(ctx, 196.0, ctx.currentTime, 0.18, { type: 'triangle', peak: 0.18 }); // G3
    setTimeout(() => ctx.close(), 400);
  } catch { /* ignore — non-essential */ }
}

/** Two quick low pulses — your turn is about to run out. */
export function playWarningChime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.16].forEach(offset =>
      tone(ctx, 220.0, ctx.currentTime + offset, 0.12, { type: 'square', peak: 0.16 })); // A3
    setTimeout(() => ctx.close(), 500);
  } catch { /* ignore — non-essential */ }
}
