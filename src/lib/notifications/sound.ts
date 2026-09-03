/**
 * Web Audio Synthesized Notification Chime
 *
 * Generates an instantaneous, pleasant, high-fidelity two-tone chime (A5 -> E6)
 * using the native browser Web Audio API without requiring any external audio files.
 */

let soundEnabled = true;

if (typeof window !== 'undefined') {
  const stored = localStorage.getItem('masacrm_notification_sound') ?? localStorage.getItem('wacrm_notification_sound');
  if (stored !== null) {
    soundEnabled = stored === 'true';
  }
}

export function isSoundEnabled(): boolean {
  return soundEnabled;
}

export function setSoundEnabled(enabled: boolean): void {
  soundEnabled = enabled;
  if (typeof window !== 'undefined') {
    localStorage.setItem('masacrm_notification_sound', enabled ? 'true' : 'false');
  }
}

export function playNotificationSound(): void {
  if (typeof window === 'undefined' || !soundEnabled) return;

  try {
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;

    if (!AudioContextClass) return;

    const ctx = new AudioContextClass();

    // Resume if suspended by browser autoplay policy
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    const now = ctx.currentTime;

    // First Bell Tone (A5 - 880 Hz)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(880, now);
    gain1.gain.setValueAtTime(0.12, now);
    gain1.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.22);

    // Second Bell Tone (E6 - 1318.5 Hz)
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(1318.51, now + 0.08);
    gain2.gain.setValueAtTime(0.15, now + 0.08);
    gain2.gain.exponentialRampToValueAtTime(0.0001, now + 0.38);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.08);
    osc2.stop(now + 0.38);
  } catch {
    // Autoplay restrictions or audio device unavailable
  }
}
