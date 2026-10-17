import { getPrefs } from "./devices";

/**
 * Sons curtos da voz (entrar, sair, mutar...), gerados na hora com Web Audio.
 * São nossos, não os do Discord: dois ou três bipes suaves.
 */
type Sound = "join" | "leave" | "selfJoin" | "selfLeave" | "mute" | "unmute" | "deafen" | "undeafen" | "message";

const NOTES: Record<Sound, [number, number][]> = {
  // [frequência Hz, duração s] em sequência
  join: [[660, 0.08], [990, 0.12]],
  leave: [[880, 0.08], [520, 0.12]],
  selfJoin: [[523, 0.07], [659, 0.07], [784, 0.12]],
  selfLeave: [[784, 0.07], [659, 0.07], [440, 0.14]],
  mute: [[600, 0.06], [420, 0.08]],
  unmute: [[420, 0.06], [600, 0.08]],
  deafen: [[500, 0.07], [350, 0.07], [250, 0.1]],
  undeafen: [[250, 0.07], [350, 0.07], [500, 0.1]],
  message: [[1046, 0.05], [1318, 0.09]],
};

let ctx: AudioContext | null = null;

export function playSound(sound: Sound) {
  if (!getPrefs().sounds) return;
  try {
    ctx ??= new AudioContext();
    void ctx.resume();
    let t = ctx.currentTime + 0.01;
    for (const [freq, dur] of NOTES[sound]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.12, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + dur + 0.02);
      t += dur * 0.85;
    }
  } catch {
    /* sem áudio */
  }
}
