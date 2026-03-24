import { useRef, useState, useCallback, useEffect, useLayoutEffect } from 'react';
import { useStore, nextAvailableName, type SampleEntry } from '../store';
import { fileToMono, MG_SAMPLE_RATE } from '../audio/resample';
import { startRecording, type RecorderHandle } from '../audio/recorder';
import type { BitDepth } from '../audio/wavEncoder';
import './SampleLibrary.css';

const VALID_NAME = /^[a-zA-Z][[a-zA-Z0-9]\b$/;
const MG_RATE = MG_SAMPLE_RATE;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeId() {
  return Math.random().toString(36).slice(2, 10);
}

function formatDuration(samples: Float32Array) {
  const secs = samples.length / MG_RATE;
  return secs < 10 ? secs.toFixed(2) + 's' : secs.toFixed(1) + 's';
}

function isValidSampleFile(file: File) {
  return file.type.startsWith('audio/') || /\.(wav|mp3|ogg|flac|aiff?|m4a|webm)$/i.test(file.name);
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function DropZone({ onFiles }: { onFiles: (files: File[]) => void }) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer.files).filter(isValidSampleFile);
    if (files.length) onFiles(files);
  }, [onFiles]);

  return (
    <div
      className={`drop-zone ${dragging ? 'drop-zone--active' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept="audio/*"
        multiple
        className="sr-only"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []).filter(isValidSampleFile);
          if (files.length) onFiles(files);
          e.target.value = '';
        }}
      />
      <span className="drop-zone-icon">+</span>
      <span>Drop audio files here or <u>click to browse</u></span>
      <span className="dimmed">WAV · MP3 · OGG · FLAC · AIFF · M4A</span>
    </div>
  );
}

function RecordBar() {
  const { samples, addSample } = useStore();
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const handleRef = useRef<RecorderHandle | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startRec = async () => {
    setError(null);
    try {
      const { handle, samplesPromise } = await startRecording();
      handleRef.current = handle;
      setRecording(true);
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed((t) => t + 1), 1000);

      const audioData = await samplesPromise;
      const usedNames = new Set(samples.map((s) => s.name));
      addSample({
        id: makeId(),
        name: nextAvailableName(usedNames),
        originalFilename: 'recording',
        audioData,
        bitDepth: 16,
        duration: audioData.length / MG_RATE,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Mic error');
    } finally {
      if (timerRef.current) clearInterval(timerRef.current);
      setRecording(false);
      setElapsed(0);
      handleRef.current = null;
    }
  };

  const stopRec = () => handleRef.current?.stop();

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

  return (
    <div className="record-bar">
      {recording ? (
        <>
          <span className="record-dot" />
          <span className="record-time">{elapsed}s</span>
          <button className="btn btn--danger" onClick={stopRec}>Stop</button>
        </>
      ) : (
        <button className="btn btn--record" onClick={startRec}>&#9679; Record from mic</button>
      )}
      {error && <span className="record-error">{error}</span>}
    </div>
  );
}

function NameInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [draft, setDraft] = useState(value);

  useEffect(() => setDraft(value), [value]);

  const commit = () => {
    const v = draft.toUpperCase();
    if (v.length === 2 && VALID_NAME.test(v)) {
      onChange(v);
    } else {
      setDraft(value); // revert
    }
  };

  return (
    <input
      className="name-input"
      value={draft}
      maxLength={2}
      onChange={(e) => {
        const v = e.target.value.toUpperCase();
        if (VALID_NAME.test(v)) setDraft(v);
      }}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && commit()}
      spellCheck={false}
    />
  );
}

// ─── Waveform ──────────────────────────────────────────────────────────────────

const BLOCK_W  = 3;   // px, drawn width of each amplitude bar
const BLOCK_GAP = 1;  // px, gap between bars
const BLOCK_SLOT = BLOCK_W + BLOCK_GAP;

function buildPeaks(audioData: Float32Array, numBlocks: number): Float32Array {
  const peaks = new Float32Array(numBlocks);
  const blockSize = audioData.length / numBlocks;
  for (let b = 0; b < numBlocks; b++) {
    const start = Math.floor(b * blockSize);
    const end   = Math.min(Math.floor((b + 1) * blockSize), audioData.length);
    let peak = 0;
    for (let i = start; i < end; i++) {
      const abs = Math.abs(audioData[i]);
      if (abs > peak) peak = abs;
    }
    peaks[b] = peak;
  }
  return peaks;
}

function WaveformCanvas({ audioData, playState, getPosition }: {
  audioData: Float32Array;
  playState: 'playing' | 'paused' | 'stopped';
  getPosition: () => number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [cursorPct, setCursorPct] = useState(0);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const W = canvas.offsetWidth;
    const H = canvas.offsetHeight;
    if (W === 0 || H === 0) return;

    // Resize backing store to match CSS pixels (no DPR scaling — keeps blocks crisp)
    canvas.width  = W;
    canvas.height = H;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);

    const numBlocks = Math.floor(W / BLOCK_SLOT);
    const peaks = buildPeaks(audioData, numBlocks);
    const halfH = H / 2;

    ctx.fillStyle = 'rgba(85, 136, 255, 0.72)';
    for (let b = 0; b < numBlocks; b++) {
      const halfBar = Math.max(1, Math.round(peaks[b] * halfH));
      ctx.fillRect(b * BLOCK_SLOT, halfH - halfBar, BLOCK_W, halfBar * 2);
    }
  }, [audioData]);

  // Re-draw waveform when audioData changes or container resizes
  useLayoutEffect(() => {
    draw();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(draw);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [draw]);

  // Animate cursor position
  useEffect(() => {
    const totalSecs = audioData.length / MG_RATE;
    if (playState === 'stopped') {
      setCursorPct(0);
      return;
    }
    if (playState === 'paused') {
      setCursorPct(Math.min(1, getPosition() / totalSecs));
      return;
    }
    // playing — drive via rAF
    let rafId: number;
    const tick = () => {
      setCursorPct(Math.min(1, getPosition() / totalSecs));
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [playState, getPosition, audioData.length]);

  return (
    <div className="waveform-wrap">
      <canvas ref={canvasRef} className="waveform-canvas" />
      <div
        className="waveform-cursor"
        style={{ left: `${cursorPct * 100}%`, opacity: playState === 'stopped' ? 0 : 1 }}
      />
    </div>
  );
}

// ─── Sample row ────────────────────────────────────────────────────────────────

function SampleRow({ entry, playState, getPosition, onPlay, onPause, onStop, onDelete }: {
  entry: SampleEntry;
  playState: 'playing' | 'paused' | 'stopped';
  getPosition: () => number;
  onPlay: (entry: SampleEntry) => void;
  onPause: () => void;
  onStop: () => void;
  onDelete: (id: string) => void;
}) {
  const { updateSample, samples } = useStore();
  const usedNames = new Set(samples.filter((s) => s.id !== entry.id).map((s) => s.name));

  const handleNameChange = (name: string) => {
    if (usedNames.has(name)) return;
    updateSample(entry.id, { name });
  };

  const active = playState !== 'stopped';

  return (
    <div className={`sample-row ${active ? 'sample-row--active' : ''}`}>
      <div className="sample-row-controls">
        <NameInput value={entry.name} onChange={handleNameChange} />
        <span className="sample-filename" title={entry.originalFilename}>
          {entry.originalFilename}
        </span>
        <span className="sample-duration dimmed">{formatDuration(entry.audioData)}</span>
        <select
          className="bitdepth-select"
          value={entry.bitDepth}
          onChange={(e) => updateSample(entry.id, { bitDepth: Number(e.target.value) as BitDepth })}
        >
          <option value={16}>16-bit</option>
          <option value={8}>8-bit</option>
        </select>
        <div className="playback-btns">
          {/* Play / Resume */}
          <button
            className={`icon-btn ${playState === 'playing' ? 'icon-btn--active' : ''}`}
            title={playState === 'paused' ? 'Resume' : 'Play'}
            onClick={() => onPlay(entry)}
            disabled={playState === 'playing'}
          >
            ▶
          </button>
          {/* Pause */}
          <button
            className="icon-btn"
            title="Pause"
            onClick={onPause}
            disabled={!active || playState === 'paused'}
          >
            ⏸
          </button>
          {/* Stop */}
          <button
            className="icon-btn"
            title="Stop"
            onClick={onStop}
            disabled={!active}
          >
            ⏹
          </button>
        </div>
        <button className="icon-btn icon-btn--danger" title="Remove" onClick={() => onDelete(entry.id)}>✕</button>
      </div>
      <WaveformCanvas audioData={entry.audioData} playState={playState} getPosition={getPosition} />
    </div>
  );
}

// ─── microGranny filename detection ──────────────────────────────────────────

// Matches any audio file whose name starts with a letter followed by a letter or digit
const MG_FILENAME_RE = /^([A-Z][A-Z0-9])/i;

// Persists for the lifetime of the page; reset only on refresh.
let sessionMgDecision: 'use' | 'skip' | null = null;

function isMgFilename(filename: string): string | null {
  const m = MG_FILENAME_RE.exec(filename);
  return m ? m[1].toUpperCase() : null;
}

// ─── MG import dialog ─────────────────────────────────────────────────────────

interface MgDialogState {
  filename: string;
  proposedName: string;
  nameInUse: boolean;
  resolve: (r: { useName: boolean; saveForSession: boolean }) => void;
}

function MgDialog({ state }: { state: MgDialogState }) {
  const { filename, proposedName, nameInUse, resolve } = state;
  const [saveForSession, setSaveForSession] = useState(true);

  const decide = (useName: boolean) => resolve({ useName, saveForSession });

  return (
    <div className="modal-backdrop">
      <div className="modal" role="dialog" aria-modal="true">
        <h2 className="modal-title">microGranny sample?</h2>
        <p className="modal-body">
          <strong>{filename}</strong> looks like a microGranny sample filename.
          Use <strong>{proposedName}</strong> as its two-character name?
        </p>

        {nameInUse && (
          <p className="modal-warning">
            ⚠ <strong>{proposedName}</strong> is already in use by another sample.
            Using it anyway will create a duplicate name.
          </p>
        )}

        <div className="modal-checkboxes">
          <label className="modal-checkbox">
            <input
              type="checkbox"
              checked={saveForSession}
              onChange={(e) => setSaveForSession(e.target.checked)}
            />
            Remember this choice for the rest of the session
          </label>
        </div>

        <div className="modal-actions">
          <button className="btn modal-btn-secondary" onClick={() => decide(false)}>
            No, auto-name
          </button>
          <button className="btn modal-btn-primary" onClick={() => decide(true)}>
            Yes, use &ldquo;{proposedName}&rdquo;
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Playback engine ──────────────────────────────────────────────────────────

interface PlaybackRef {
  sourceNode: AudioBufferSourceNode | null;
  /** AudioContext.currentTime at the moment play/resume was called */
  startedAt: number;
  /** Seconds into the buffer where playback began (non-zero after pause) */
  offset: number;
}

// ─── Main component ───────────────────────────────────────────────────────────

type SortKey = 'name' | 'file' | 'duration';
type SortDir = 'asc' | 'desc';

export default function SampleLibrary() {
  const { samples, addSample, removeSample } = useStore();
  const [processing, setProcessing]   = useState<string[]>([]);
  const [decodeErrors, setDecodeErrors] = useState<string[]>([]);
  const [mgDialog, setMgDialog]       = useState<MgDialogState | null>(null);
  const [sortKey, setSortKey]         = useState<SortKey>('name');
  const [sortDir, setSortDir]         = useState<SortDir>('asc');

  // Which sample is active and its play/pause state
  const [activeId, setActiveId]       = useState<string | null>(null);
  const [playState, setPlayState]     = useState<'playing' | 'paused' | 'stopped'>('stopped');

  const audioCtxRef = useRef<AudioContext | null>(null);
  const pbRef       = useRef<PlaybackRef>({ sourceNode: null, startedAt: 0, offset: 0 });

  const getCtx = useCallback(async () => {
    if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
      audioCtxRef.current = new AudioContext();
    }
    if (audioCtxRef.current.state === 'suspended') await audioCtxRef.current.resume();
    return audioCtxRef.current;
  }, []);

  const stopSource = useCallback(() => {
    try { pbRef.current.sourceNode?.stop(); } catch { /* already stopped */ }
    pbRef.current.sourceNode = null;
  }, []);

  const startSource = useCallback(async (entry: SampleEntry, offset: number) => {
    const ctx = await getCtx();
    const buf = ctx.createBuffer(1, entry.audioData.length, MG_RATE);
    buf.copyToChannel(entry.audioData, 0);

    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(0, offset);
    src.onended = () => {
      // Only auto-reset if this node is still the active one (not stopped manually)
      if (pbRef.current.sourceNode === src) {
        pbRef.current.sourceNode = null;
        pbRef.current.offset = 0;
        setPlayState('stopped');
      }
    };

    pbRef.current.sourceNode = src;
    pbRef.current.startedAt  = ctx.currentTime;
    pbRef.current.offset     = offset;
  }, [getCtx]);

  const handlePlay = useCallback(async (entry: SampleEntry) => {
    // If a different sample is active, stop it first
    if (activeId && activeId !== entry.id) {
      stopSource();
      pbRef.current.offset = 0;
    }

    const offset = activeId === entry.id && playState === 'paused'
      ? pbRef.current.offset   // resume from where we paused
      : 0;                     // fresh play

    setActiveId(entry.id);
    setPlayState('playing');
    await startSource(entry, offset);
  }, [activeId, playState, startSource, stopSource]);

  const handlePause = useCallback(() => {
    if (!audioCtxRef.current || playState !== 'playing') return;
    const elapsed = audioCtxRef.current.currentTime - pbRef.current.startedAt;
    pbRef.current.offset += elapsed;
    stopSource();
    setPlayState('paused');
  }, [playState, stopSource]);

  const handleStop = useCallback(() => {
    stopSource();
    pbRef.current.offset = 0;
    setActiveId(null);
    setPlayState('stopped');
  }, [stopSource]);

  const handleDelete = useCallback((id: string) => {
    if (activeId === id) {
      stopSource();
      pbRef.current.offset = 0;
      setActiveId(null);
      setPlayState('stopped');
    }
    removeSample(id);
  }, [activeId, stopSource, removeSample]);

  /** Returns current playback position in seconds for the active sample. */
  const getPosition = useCallback((): number => {
    if (playState === 'stopped') return 0;
    if (playState === 'paused')  return pbRef.current.offset;
    const ctx = audioCtxRef.current;
    if (!ctx) return pbRef.current.offset;
    return pbRef.current.offset + (ctx.currentTime - pbRef.current.startedAt);
  }, [playState]);

  const noopGetPosition = useCallback(() => 0, []);

  const handleSortClick = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const sortedSamples = [...samples].sort((a, b) => {
    let cmp = 0;
    if (sortKey === 'name')     cmp = a.name.localeCompare(b.name);
    if (sortKey === 'file')     cmp = a.originalFilename.localeCompare(b.originalFilename);
    if (sortKey === 'duration') cmp = a.audioData.length - b.audioData.length;
    return sortDir === 'asc' ? cmp : -cmp;
  });

  // Stop audio when navigating away from this tab
  useEffect(() => {
    return () => {
      stopSource();
      audioCtxRef.current?.close().catch(() => {});
    };
  }, [stopSource]);

  /** Prompt the user about a MG-looking filename. Returns a promise that
   *  resolves once they click a button. */
  const askMg = useCallback((
    filename: string,
    proposedName: string,
    nameInUse: boolean,
  ): Promise<{ useName: boolean; saveForSession: boolean }> =>
    new Promise((resolve) =>
      setMgDialog({ filename, proposedName, nameInUse, resolve }),
    ),
  []);

  const processFiles = useCallback(async (files: File[]) => {
    setProcessing(files.map((f) => f.name));
    setDecodeErrors([]);

    const usedNamesRef = new Set(samples.map((s) => s.name));
    const mgFiles = files.map((f) => isMgFilename(f.name));

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        const audioData = await fileToMono(file);
        const proposedMgName = mgFiles[i];

        let name: string;

        if (proposedMgName !== null) {
          const nameInUse = usedNamesRef.has(proposedMgName);

          let useName: boolean;
          if (sessionMgDecision !== null) {
            useName = sessionMgDecision === 'use' && !nameInUse;
          } else {
            const result = await askMg(file.name, proposedMgName, nameInUse);
            setMgDialog(null);
            if (result.saveForSession) sessionMgDecision = result.useName ? 'use' : 'skip';
            useName = result.useName;
          }

          name = useName ? proposedMgName : nextAvailableName(usedNamesRef);
        } else {
          name = nextAvailableName(usedNamesRef);
        }

        usedNamesRef.add(name);
        addSample({ id: makeId(), name, originalFilename: file.name, audioData, bitDepth: 16, duration: audioData.length / MG_RATE });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setDecodeErrors((prev) => [...prev, `${file.name}: ${msg}`]);
      }
    }
    setProcessing([]);
  }, [samples, addSample, askMg]);

  return (
    <div className="sample-library">
      {mgDialog && <MgDialog state={mgDialog} />}

      <div className="sample-library-top">
        <DropZone onFiles={processFiles} />
        <RecordBar />
      </div>

      {processing.length > 0 && (
        <div className="processing-bar dimmed">Processing: {processing.join(', ')}…</div>
      )}

      {decodeErrors.length > 0 && (
        <div className="decode-error-box">
          <strong>Failed to decode {decodeErrors.length === 1 ? 'one file' : `${decodeErrors.length} files`}:</strong>
          <ul>
            {decodeErrors.map((msg, i) => <li key={i}>{msg}</li>)}
          </ul>
          <button className="decode-error-dismiss" onClick={() => setDecodeErrors([])}>✕</button>
        </div>
      )}

      <div className="sample-list">
        {samples.length === 0 ? (
          <div className="sample-empty dimmed">No samples loaded yet.</div>
        ) : (
          <>
            <div className="sample-list-header">
              {(['name', 'file', 'duration'] as SortKey[]).map((key, i) => (
                <button
                  key={key}
                  className={`sort-header ${sortKey === key ? 'sort-header--active' : ''}`}
                  onClick={() => handleSortClick(key)}
                  style={i === 1 ? { textAlign: 'left' } : undefined}
                >
                  {key === 'name' ? 'Name' : key === 'file' ? 'File' : 'Duration'}
                  <span className="sort-arrow">
                    {sortKey === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ' ⬍'}
                  </span>
                </button>
              ))}
              <span>Bit depth</span>
              <span>Playback</span>
              <span></span>
            </div>
            {sortedSamples.map((entry) => {
              const isActive = activeId === entry.id;
              return (
                <SampleRow
                  key={entry.id}
                  entry={entry}
                  playState={isActive ? playState : 'stopped'}
                  getPosition={isActive ? getPosition : noopGetPosition}
                  onPlay={handlePlay}
                  onPause={handlePause}
                  onStop={handleStop}
                  onDelete={handleDelete}
                />
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
