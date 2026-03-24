/**
 * Browser microphone recorder.
 *
 * Records from the default input device and returns a Float32Array of
 * mono samples at the target rate (default 22050 Hz), ready for WAV encoding.
 */

import { MG_SAMPLE_RATE, resampleBuffer } from './resample';

export interface RecorderHandle {
  /** Stop recording and resolve the promise returned by start(). */
  stop: () => void;
  /** Discard the recording without resolving. */
  cancel: () => void;
}

/**
 * Request mic access, record until stop() is called, then return
 * resampled mono Float32Array at targetRate.
 *
 * Usage:
 *   const handle = await startRecording(setHandle);
 *   // ... later ...
 *   const samples = await handle.samplesPromise;
 */
export interface RecordingSession {
  handle: RecorderHandle;
  samplesPromise: Promise<Float32Array>;
}

export async function startRecording(
  targetRate = MG_SAMPLE_RATE,
): Promise<RecordingSession> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
    video: false,
  });

  // Prefer a format the browser can decode back later
  const mimeType = getSupportedMimeType();
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks: Blob[] = [];

  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  let resolveFloat!: (f: Float32Array) => void;
  let rejectFloat!: (e: unknown) => void;

  const samplesPromise = new Promise<Float32Array>((res, rej) => {
    resolveFloat = res;
    rejectFloat = rej;
  });

  recorder.onstop = async () => {
    // Stop all mic tracks
    stream.getTracks().forEach((t) => t.stop());

    try {
      const blob = new Blob(chunks, { type: mimeType ?? 'audio/webm' });
      const arrayBuf = await blob.arrayBuffer();

      const decodeCtx = new AudioContext();
      let sourceBuf: AudioBuffer;
      try {
        sourceBuf = await decodeCtx.decodeAudioData(arrayBuf);
      } finally {
        decodeCtx.close();
      }

      const mono = await resampleBuffer(sourceBuf, targetRate);
      resolveFloat(mono);
    } catch (err) {
      rejectFloat(err);
    }
  };

  recorder.onerror = (e) => {
    stream.getTracks().forEach((t) => t.stop());
    rejectFloat(e);
  };

  recorder.start();

  const handle: RecorderHandle = {
    stop: () => {
      if (recorder.state !== 'inactive') recorder.stop();
    },
    cancel: () => {
      recorder.ondataavailable = null;
      recorder.onstop = null;
      if (recorder.state !== 'inactive') recorder.stop();
      stream.getTracks().forEach((t) => t.stop());
    },
  };

  return { handle, samplesPromise };
}

function getSupportedMimeType(): string | null {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
  ];
  for (const type of candidates) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return null;
}
