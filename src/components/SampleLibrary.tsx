import { useRef, useState, useCallback, useEffect } from 'react';
import { useStore, nextAvailableName, type SampleEntry } from '../store';
import { fileToMono, MG_SAMPLE_RATE } from '../audio/resample';
import { startRecording, type RecorderHandle } from '../audio/recorder';
import type { BitDepth } from '../audio/wavEncoder';
import './SampleLibrary.css';

const VALID_NAME = /^[A-Z0-9]{0,2}$/;
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

function SampleRow({ entry, playState, onPlay, onPause, onStop, onDelete }: {
  entry: SampleEntry;
  playState: 'playing' | 'paused' | 'stopped';
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
  );
}

// ─── microGranny filename detection ──────────────────────────────────────────

const MG_FILENAME_RE = /^([A-Z0-9]{2})\.wav$/i;

function isMgFilename(filename: string): string | null {
  const m = MG_FILENAME_RE.exec(filename);
  return m ? m[1].toUpperCase() : null;
}

// ─── MG import dialog ─────────────────────────────────────────────────────────

interface MgDialogState {
  filename: string;
  proposedName: string;
  nameInUse: boolean;
  remainingCount: number;
  resolve: (r: { useName: boolean; applyToAll: boolean }) => void;
}

function MgDialog({ state }: { state: MgDialogState }) {
  const { filename, proposedName, nameInUse, remainingCount, resolve } = state;
  const [applyToAll, setApplyToAll] = useState(false);

  const decide = (useName: boolean) => resolve({ useName, applyToAll });

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

        {remainingCount > 0 && (
          <label className="modal-checkbox">
            <input
              type="checkbox"
              checked={applyToAll}
              onChange={(e) => setApplyToAll(e.target.checked)}
            />
            Apply this choice to the remaining {remainingCount} similar{' '}
            {remainingCount === 1 ? 'file' : 'files'}
          </label>
        )}

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

export default function SampleLibrary() {
  const { samples, addSample, removeSample } = useStore();
  const [processing, setProcessing]   = useState<string[]>([]);
  const [decodeErrors, setDecodeErrors] = useState<string[]>([]);
  const [mgDialog, setMgDialog]       = useState<MgDialogState | null>(null);

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

  /** Prompt the user about a MG-looking filename. Returns a promise that
   *  resolves once they click a button. */
  const askMg = useCallback((
    filename: string,
    proposedName: string,
    nameInUse: boolean,
    remainingCount: number,
  ): Promise<{ useName: boolean; applyToAll: boolean }> =>
    new Promise((resolve) =>
      setMgDialog({ filename, proposedName, nameInUse, remainingCount, resolve }),
    ),
  []);

  const processFiles = useCallback(async (files: File[]) => {
    setProcessing(files.map((f) => f.name));
    setDecodeErrors([]);

    const usedNamesRef = new Set(samples.map((s) => s.name));
    // Count how many MG-looking files are in this batch (for "apply to all")
    const mgFiles = files.map((f) => isMgFilename(f.name));
    // batchDecision is set when user checks "apply to all"
    let batchDecision: 'use' | 'skip' | null = null;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        const audioData = await fileToMono(file);
        const proposedMgName = mgFiles[i];

        let name: string;

        if (proposedMgName !== null) {
          const nameInUse = usedNamesRef.has(proposedMgName);

          let useName: boolean;
          if (batchDecision !== null) {
            // Use the remembered batch choice; skip if name is taken (can't warn interactively)
            useName = batchDecision === 'use' && !nameInUse;
          } else {
            // How many more MG-looking files follow in this batch?
            const remaining = mgFiles.slice(i + 1).filter(Boolean).length;
            const result = await askMg(file.name, proposedMgName, nameInUse, remaining);
            setMgDialog(null);
            if (result.applyToAll) batchDecision = result.useName ? 'use' : 'skip';
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
              <span>Name</span>
              <span>File</span>
              <span>Duration</span>
              <span>Bit depth</span>
              <span>Playback</span>
              <span></span>
            </div>
            {samples.map((entry) => (
              <SampleRow
                key={entry.id}
                entry={entry}
                playState={activeId === entry.id ? playState : 'stopped'}
                onPlay={handlePlay}
                onPause={handlePause}
                onStop={handleStop}
                onDelete={handleDelete}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
