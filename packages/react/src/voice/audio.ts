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
 * Echo cancellation on so laptops work without headphones. Noise suppression
 * off: the server already denoises, and stacking a second layer hurts
 * transcription (live docs, 2026-09-11).
 */
export async function createCapture(
  ctx: AudioContext,
  onChunk: (base64Pcm16: string) => void,
): Promise<Capture> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: true },
  });

  const url = URL.createObjectURL(new Blob([PCM_WORKLET_SOURCE], { type: 'application/javascript' }));
  try {
    await ctx.audioWorklet.addModule(url);
  } finally {
    URL.revokeObjectURL(url);
  }

  const source = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, 'pointto-pcm', { numberOfOutputs: 0 });
  node.port.onmessage = (e: MessageEvent<ArrayBuffer>) => onChunk(toBase64(e.data));
  source.connect(node);

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

/**
 * Schedules chunks back to back on the audio clock rather than sleeping, so
 * network jitter is absorbed and there are no pops between chunks.
 */
export function createPlayback(ctx: AudioContext): Playback {
  let nextStart = 0;
  let live: AudioBufferSourceNode[] = [];

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
      const at = Math.max(ctx.currentTime, nextStart);
      src.start(at);
      nextStart = at + buffer.duration;
      live.push(src);
      src.onended = () => {
        live = live.filter((s) => s !== src);
      };
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
    },
  };
}
