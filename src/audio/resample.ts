/**
 * Resamples and downmixes an AudioBuffer to mono at a target sample rate
 * using the browser's OfflineAudioContext (high-quality sinc resampler).
 */

export const MG_SAMPLE_RATE = 22050;

/**
 * Decode an audio file (any browser-supported format) from an ArrayBuffer
 * and resample it to mono at targetSampleRate.
 *
 * @param fileBuffer   Raw bytes of the audio file (e.g. from File.arrayBuffer())
 * @param targetRate   Target sample rate in Hz (default: 22050)
 * @returns            Mono Float32Array at targetRate
 */
export async function decodeAndResample(
  fileBuffer: ArrayBuffer,
  targetRate = MG_SAMPLE_RATE,
): Promise<Float32Array> {
  // Decode the source file at its native sample rate
  const decodeCtx = new AudioContext();
  let sourceBuf: AudioBuffer;
  try {
    sourceBuf = await decodeCtx.decodeAudioData(fileBuffer.slice(0));
  } finally {
    decodeCtx.close();
  }

  return resampleBuffer(sourceBuf, targetRate);
}

/**
 * Resample an existing AudioBuffer to mono at targetRate.
 */
export async function resampleBuffer(
  sourceBuf: AudioBuffer,
  targetRate = MG_SAMPLE_RATE,
): Promise<Float32Array> {
  const targetLength = Math.ceil((sourceBuf.duration * targetRate));

  const offlineCtx = new OfflineAudioContext(
    1,           // mono output
    targetLength,
    targetRate,
  );

  const source = offlineCtx.createBufferSource();

  // Downmix to mono: if source is stereo, sum channels into a single-channel
  // buffer at the source's native rate before handing to the offline context.
  if (sourceBuf.numberOfChannels > 1) {
    source.buffer = downmixToMono(sourceBuf, offlineCtx);
  } else {
    source.buffer = sourceBuf;
  }

  source.connect(offlineCtx.destination);
  source.start(0);

  const rendered = await offlineCtx.startRendering();
  return rendered.getChannelData(0).slice();
}

/**
 * Sum all channels of an AudioBuffer into a new mono AudioBuffer.
 * The result has the same sample rate as the source.
 */
function downmixToMono(buf: AudioBuffer, _ctx: BaseAudioContext): AudioBuffer {
  const numChannels = buf.numberOfChannels;
  const len = buf.length;
  const monoCtx = new OfflineAudioContext(1, len, buf.sampleRate);
  const monoBuf = monoCtx.createBuffer(1, len, buf.sampleRate);
  const out = monoBuf.getChannelData(0);

  for (let ch = 0; ch < numChannels; ch++) {
    const chData = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      out[i] += chData[i];
    }
  }
  for (let i = 0; i < len; i++) {
    out[i] /= numChannels;
  }

  return monoBuf;
}

/**
 * Decode raw audio bytes from a browser File into a Float32Array
 * ready for WAV encoding.
 */
export async function fileToMono(
  file: File,
  targetRate = MG_SAMPLE_RATE,
): Promise<Float32Array> {
  const buf = await file.arrayBuffer();
  return decodeAndResample(buf, targetRate);
}
