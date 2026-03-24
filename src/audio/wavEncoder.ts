/**
 * Encodes a mono Float32Array of audio samples into a WAV file (Uint8Array).
 *
 * The microGranny 2.0 accepts:
 *   - Sample rate: 22050 Hz
 *   - Channels:    Mono
 *   - Bit depth:   8-bit (unsigned PCM) or 16-bit (signed PCM)
 */

export type BitDepth = 8 | 16;

/**
 * Convert a mono Float32 audio buffer to a WAV Uint8Array.
 *
 * @param samples   Float32Array of mono samples, range [-1, 1]
 * @param sampleRate  Must be 22050 for microGranny compatibility
 * @param bitDepth  8 or 16
 */
export function encodeWav(
  samples: Float32Array,
  sampleRate: number,
  bitDepth: BitDepth,
): Uint8Array {
  const bytesPerSample = bitDepth / 8;
  const dataBytes = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);

  // RIFF header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeString(view, 8, 'WAVE');

  // fmt chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);                          // chunk size
  view.setUint16(20, 1, true);                           // PCM format
  view.setUint16(22, 1, true);                           // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true); // byte rate
  view.setUint16(32, bytesPerSample, true);              // block align
  view.setUint16(34, bitDepth, true);

  // data chunk
  writeString(view, 36, 'data');
  view.setUint32(40, dataBytes, true);

  if (bitDepth === 16) {
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
  } else {
    // 8-bit PCM is unsigned: silence = 128
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      view.setUint8(44 + i, Math.round((s + 1) * 127.5));
    }
  }

  return new Uint8Array(buffer);
}

function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}
