import { PCM_WORKLET_SOURCE } from './worklet';

export const AGENT_SAMPLE_RATE = 24000;

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

function fromBase64(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

export interface Capture {
  stop(): void;
}

/**
 * Opens the microphone — the ONLY place in the library that does — and streams
 * base64 PCM16 @ 24 kHz chunks to `onChunk`.
 *
 * Constraints match AssemblyAI's official browser sketch: echo cancellation,
 * noise suppression, and auto gain all on. The browser's AEC is what stops the
 * agent's own voice coming back through the mic as "user speech".
 */
export async function createCapture(
  ctx: AudioContext,
  onChunk: (base64Pcm16: string) => void,
): Promise<Capture> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });

  const url = URL.createObjectURL(new Blob([PCM_WORKLET_SOURCE], { type: 'application/javascript' }));
  try {
    await ctx.audioWorklet.addModule(url);
  } finally {
    URL.revokeObjectURL(url);
  }

  const source = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, 'pointto-pcm');
  node.port.onmessage = (e: MessageEvent<ArrayBuffer>) => onChunk(toBase64(e.data));
  // Connected through to the destination as in the official sketch, so the
  // graph is guaranteed to be processed. The worklet writes no output, so
  // nothing from the mic reaches the speakers.
  source.connect(node).connect(ctx.destination);

  return {
    stop() {
      node.port.onmessage = null;
      source.disconnect();
      node.disconnect();
      for (const t of stream.getTracks()) t.stop();
    },
  };
}

export interface Playback {
  /** Queue a `reply.audio` chunk (base64 PCM16 @ 24 kHz). */
  push(base64Pcm16: string): void;
  /** Drop everything scheduled — the user interrupted. */
  flush(): void;
}

/** RMS of a PCM16 chunk, scaled so normal speech lands around 0.4–0.9. */
function level(pcm: Int16Array): number {
  if (pcm.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < pcm.length; i++) sum += pcm[i]! * pcm[i]!;
  return Math.min(1, (Math.sqrt(sum / pcm.length) / 32768) * 4);
}

/**
 * Schedules chunks back to back on the audio clock rather than sleeping.
 *
 * The server streams 10 ms chunks at exactly real time (measured: 8.34 s of
 * audio arrived in 8.33 s). Scheduling each one at max(now, head) with no
 * slack means any network jitter over 10 ms becomes an audible gap, and the
 * voice sounds chopped. So when a reply starts — or whenever we have fallen
 * behind — the head is pushed LEAD_S ahead of now, giving the stream a small
 * buffer to absorb jitter. 150 ms is below what a listener notices as delay.
 */
const LEAD_S = 0.15;

export function createPlayback(ctx: AudioContext, onLevel?: (level: number) => void): Playback {
  let nextStart = 0;
  let live: AudioBufferSourceNode[] = [];
  let timers: ReturnType<typeof setTimeout>[] = [];

  return {
    push(b64) {
      const pcm = new Int16Array(fromBase64(b64));
      if (pcm.length === 0) return;
      const buffer = ctx.createBuffer(1, pcm.length, AGENT_SAMPLE_RATE);
      const ch = buffer.getChannelData(0);
      for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i]! / 32768;

      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(ctx.destination);
      // Fallen behind (or first chunk of a reply): re-establish the lead.
      if (nextStart < ctx.currentTime) nextStart = ctx.currentTime + LEAD_S;
      const at = nextStart;
      src.start(at);
      nextStart = at + buffer.duration;
      live.push(src);
      src.onended = () => {
        live = live.filter((s) => s !== src);
        if (live.length === 0) onLevel?.(0);
      };
      if (onLevel) {
        // Report the level when this chunk is actually heard, not when it
        // arrived, so the glow moves with the voice rather than ahead of it.
        const lvl = level(pcm);
        const t = setTimeout(() => onLevel(lvl), Math.max(0, (at - ctx.currentTime) * 1000));
        timers.push(t);
      }
    },
    flush() {
      for (const s of live) {
        try {
          s.stop();
        } catch {
          /* already stopped */
        }
      }
      live = [];
      nextStart = 0;
      for (const t of timers) clearTimeout(t);
      timers = [];
      onLevel?.(0);
    },
  };
}
