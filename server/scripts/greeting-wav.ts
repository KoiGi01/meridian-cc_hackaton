/**
 * Diagnostic: connect to the Voice Agent API from Node, capture the greeting,
 * write it as a WAV. No browser, no AudioContext, no mic. If this file sounds
 * right in a normal player, the audio data is fine and any problem is in
 * browser playback. Run: node --experimental-strip-types server/scripts/greeting-wav.ts [voice] [out.wav]
 */
import { writeFileSync } from 'node:fs';
import { env } from '../src/env.ts';

const voice = process.argv[2] ?? 'anna';
const out = process.argv[3] ?? 'greeting.wav';
const RATE = 24_000;

const ws = new WebSocket('wss://agents.assemblyai.com/v1/ws', {
  // Node's WebSocket accepts headers via this non-standard option.
  headers: { Authorization: `Bearer ${env.apiKey}` },
} as unknown as string[]);

const chunks: Buffer[] = [];
const t0 = Date.now();

ws.onopen = () => {
  ws.send(
    JSON.stringify({
      type: 'session.update',
      session: {
        system_prompt: 'You are a test voice. Say the greeting and stop.',
        greeting: 'Hello! This is a playback test. If you can hear every word of this sentence clearly, the audio data is fine.',
        input: { format: { encoding: 'audio/pcm' } },
        output: { voice, format: { encoding: 'audio/pcm' } },
      },
    }),
  );
};

ws.onmessage = (e) => {
  const m = JSON.parse(String(e.data));
  if (m.type === 'reply.audio') chunks.push(Buffer.from(m.data, 'base64'));
  else if (m.type === 'session.error') {
    console.error('session.error', m);
    process.exit(1);
  } else if (m.type === 'reply.done') {
    const pcm = Buffer.concat(chunks);
    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + pcm.length, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20); // PCM
    header.writeUInt16LE(1, 22); // mono
    header.writeUInt32LE(RATE, 24);
    header.writeUInt32LE(RATE * 2, 28);
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34);
    header.write('data', 36);
    header.writeUInt32LE(pcm.length, 40);
    writeFileSync(out, Buffer.concat([header, pcm]));
    console.log(
      `voice=${voice} chunks=${chunks.length} bytes=${pcm.length} audio=${(pcm.length / 2 / RATE).toFixed(2)}s wall=${((Date.now() - t0) / 1000).toFixed(2)}s -> ${out}`,
    );
    ws.send(JSON.stringify({ type: 'session.end' }));
    ws.close();
  }
};

ws.onerror = (e) => {
  console.error('websocket error', e);
  process.exit(1);
};
