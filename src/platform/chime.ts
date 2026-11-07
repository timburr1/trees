let context: AudioContext | undefined;

/** Browsers only let audio start after a user gesture, so call this from a click, tap, or key press. Safe to call repeatedly. */
export function chimeUnlock(warn: (message: string) => void): void {
  // Audio is optional: a browser without Web Audio, or with it disabled, must not stop a session from starting.
  try {
    contextUnlock(warn);
  } catch (error) {
    warn(`Sound is unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function contextUnlock(warn: (message: string) => void): void {
  context ??= new AudioContext();
  // iOS mutes Web Audio under the ringer switch unless the page declares itself playback audio.
  const session: unknown = Reflect.get(navigator, 'audioSession');
  if (typeof session === 'object' && session !== null) {
    Reflect.set(session, 'type', 'playback');
  }
  if (context.state !== 'running') {
    context.resume().catch((error: unknown) => {
      warn(`Could not enable sound: ${error instanceof Error ? error.message : String(error)}`);
    });
  }
}

/** Two short tones. If the context was suspended (iOS does this after a lock or app switch), tries to resume it first, and warns if it cannot. */
export function chimePlay(warn: (message: string) => void): void {
  const audio = context;
  const blocked = () => warn('Your browser blocked the finish sound. Tap or press a key on the page to enable it.');
  if (!audio) {
    blocked();
    return;
  }
  if (audio.state === 'running') {
    tonesPlay(audio);
    return;
  }
  audio.resume().then(() => (audio.state === 'running' ? tonesPlay(audio) : blocked()), blocked);
}

function tonesPlay(audio: AudioContext): void {
  for (const [index, frequency] of [660, 880].entries()) {
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    const start = audio.currentTime + index * 0.25;
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.25, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.22);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start(start);
    oscillator.stop(start + 0.25);
  }
}
