import { useRef, useState, useCallback, useEffect, useLayoutEffect } from 'react';
import { useStore, type SampleEntry } from '../store';
import { type SoundSlot, SETTING_FLAG, getSettingFlags, presetFilename } from '../codec/presetCodec';
import { MG_SAMPLE_RATE } from '../audio/resample';
import './PresetEditor.css';

// ─── Parameter metadata ───────────────────────────────────────────────────────

type ParamMeta = {
  key: keyof Omit<SoundSlot, 'sampleName' | 'setting'>;
  label: string;
  min: number;
  max: number;
  center?: number;
  hint?: string;
};

const PARAMS_STANDARD: ParamMeta[] = [
  { key: 'rate',    label: 'RATE',    min: 0,   max: 1023, center: 877, hint: '877 = original pitch' },
  { key: 'crush',   label: 'CRUSH',   min: 0,   max: 127,               hint: 'bit crush depth' },
  { key: 'start',   label: 'START',   min: 0,   max: 1023,              hint: 'playback start position' },
  { key: 'end',     label: 'END',     min: 0,   max: 1023,              hint: 'playback end position' },
  { key: 'attack',  label: 'ATTACK',  min: 0,   max: 127,               hint: 'envelope attack' },
  { key: 'release', label: 'RELEASE', min: 0,   max: 127,               hint: 'envelope release' },
];

const PARAMS_GRANULAR: ParamMeta[] = [
  { key: 'loopLength', label: 'GRAIN', min: 0, max: 127,              hint: 'grain loop length' },
  { key: 'shiftSpeed', label: 'SHIFT', min: 0, max: 255, center: 128, hint: '128 = no shift' },
];

const FLAGS: { key: keyof ReturnType<typeof getSettingFlags>; label: string; bit: number }[] = [
  { key: 'tuned',  label: 'TUNED',  bit: SETTING_FLAG.TUNED  },
  { key: 'legato', label: 'LEGATO', bit: SETTING_FLAG.LEGATO  },
  { key: 'repeat', label: 'REPEAT', bit: SETTING_FLAG.REPEAT  },
  { key: 'sync',   label: 'SYNC',   bit: SETTING_FLAG.SYNC    },
];

// ── Per-parameter display formatters ─────────────────────────────────────────

const PARAM_FORMAT: Partial<Record<string, (v: number) => string>> = {
  rate:       (v) => (v / 877).toFixed(2) + '×',
  crush:      (v) => Math.round(v / 127 * 100) + '%',
  start:      (v) => Math.round(v / 1023 * 100) + '%',
  end:        (v) => Math.round(v / 1023 * 100) + '%',
  attack:     (v) => Math.round(v / 127 * 100) + '%',
  release:    (v) => Math.round(v / 127 * 100) + '%',
  shiftSpeed: (v) => {
    const p = Math.round((v - 128) / 128 * 100);
    return (p > 0 ? '+' : '') + p + '%';
  },
};

function randomizeSlot(): Partial<SoundSlot> {
  const start = Math.floor(Math.random() * 900);
  const end   = Math.min(1023, start + 50 + Math.floor(Math.random() * (1023 - start)));
  return {
    rate:       Math.floor(Math.random() * 1024),
    crush:      Math.floor(Math.random() * 128),
    start,
    end,
    attack:     Math.floor(Math.random() * 128),
    release:    Math.floor(Math.random() * 128),
    loopLength: Math.floor(Math.random() * 128),
    shiftSpeed: Math.floor(Math.random() * 256),
  };
}

// ─── Audio preview engine ─────────────────────────────────────────────────────

// Inline AudioWorklet for bit crushing (loaded via Blob URL — no extra files needed)
const BIT_CRUSH_WORKLET = `
class BitCrushProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{ name: 'bits', defaultValue: 16, minValue: 1, maxValue: 16, automationRate: 'k-rate' }];
  }
  process(inputs, outputs, parameters) {
    const input = inputs[0]?.[0];
    const output = outputs[0]?.[0];
    if (!input || !output) return true;
    const bits = parameters.bits[0];
    const step = 2 / Math.pow(2, bits);
    for (let i = 0; i < output.length; i++) {
      output[i] = input[i] !== undefined ? Math.round(input[i] / step) * step : 0;
    }
    return true;
  }
}
registerProcessor('bit-crush-processor', BitCrushProcessor);
`;

async function loadBitCrushWorklet(ctx: AudioContext): Promise<void> {
  const blob = new Blob([BIT_CRUSH_WORKLET], { type: 'application/javascript' });
  const url  = URL.createObjectURL(blob);
  try   { await ctx.audioWorklet.addModule(url); }
  finally { URL.revokeObjectURL(url); }
}

function crushBits(crush: number): number {
  // crush=0 → 16 bits (transparent), crush=127 → 2 bits (maximum crush)
  return Math.max(2, Math.round(16 - (crush / 127) * 14));
}

function slotWindow(slot: SoundSlot, totalDur: number) {
  const startPos = (slot.start / 1023) * totalDur;
  const endPos   = Math.max(startPos + 0.001, (slot.end / 1023) * totalDur);
  return { startPos, endPos };
}

/*
function applyLoopPoints(src: AudioBufferSourceNode, slot: SoundSlot, startPos: number, endPos: number) {
  const flags      = getSettingFlags(slot.setting);
  const windowDur  = endPos - startPos;

  if (slot.loopLength > 0) {
    const grainDur  = (slot.loopLength / 127) * Math.min(windowDur, 2.0);
    src.loop        = true;
    src.loopStart   = startPos;
    src.loopEnd     = startPos + Math.max(grainDur, 0.005);
  } else if (flags.repeat) {
    src.loop        = true;
    src.loopStart   = startPos;
    src.loopEnd     = endPos;
  }
}
*/

const GRAIN_LOOKAHEAD = 0.12; // seconds ahead to schedule grains
const GRAIN_INTERVAL  = 40;   // ms between scheduler runs

interface AudioState {
  ctx:       AudioContext;
  gainNode:  GainNode;           // envelope; all sources connect here
  crushNode: AudioWorkletNode;   // bit-crush; gainNode → crushNode → destination
  buf:       AudioBuffer;
  // Linear mode (loopLength === 0)
  src:       AudioBufferSourceNode | null;
  startedAt: number;
  offset:    number;
  // Grain mode (loopLength > 0)
  grainPos:  number;  // grain head position in seconds (from buf start)
  nextTime:  number;  // next grain's scheduled ctx.currentTime
  timerId:   ReturnType<typeof setTimeout> | null;
}

// ─── Bank / preset grid ───────────────────────────────────────────────────────

function BankPresetGrid() {
  const { activeBank, activePreset, setActivePreset, presets, importedPresets } = useStore();

  return (
    <div className="bp-grid">
      <div className="bp-grid-header">
        <span />
        {[1, 2, 3, 4, 5, 6].map((p) => (
          <span key={p} className="bp-label">{p}</span>
        ))}
      </div>
      {Array.from({ length: 10 }, (_, bank) => (
        <div key={bank} className="bp-row">
          <span className="bp-label">{bank}</span>
          {Array.from({ length: 6 }, (_, p) => {
            const key      = presetFilename(bank, p);
            const active   = activeBank === bank && activePreset === p;
            const imported = importedPresets.has(key);
            const hasData  = !!presets[key] && !imported;
            return (
              <button
                key={p}
                className={[
                  'bp-cell',
                  active   ? 'bp-cell--active'   : '',
                  imported ? 'bp-cell--imported'  : '',
                  hasData  ? 'bp-cell--has-data'  : '',
                ].join(' ')}
                onClick={() => setActivePreset(bank, p)}
                title={`Bank ${bank}, Preset ${p + 1}${imported ? ' (imported)' : ''}`}
              />
            );
          })}
        </div>
      ))}
      <div className="bp-legend dimmed">
        <span className="bp-dot bp-dot--data" /> edited
        <span className="bp-dot bp-dot--imported" /> imported
      </div>
    </div>
  );
}

// ─── Slot editor ──────────────────────────────────────────────────────────────

function ParamSlider({
  label, value, min, max, center, hint, format, onChange,
}: {
  label: string; value: number; min: number; max: number;
  center?: number; hint?: string;
  format?: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="param-row" title={hint}>
      <span className="param-label">{label}</span>
      <input
        type="range"
        className="param-slider"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className={`param-value ${center !== undefined && value === center ? 'param-value--center' : ''}`}>
        {format ? format(value) : value}
      </span>
    </div>
  );
}

function FlagToggle({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      className={`flag-btn ${active ? 'flag-btn--on' : ''}`}
      onClick={onClick}
      title={label}
    >
      {label}
    </button>
  );
}

// ─── Slot waveform ────────────────────────────────────────────────────────────

const SW_BLOCK_W    = 3;
const SW_BLOCK_GAP  = 1;
const SW_BLOCK_SLOT = SW_BLOCK_W + SW_BLOCK_GAP;

// Approximate MG timing
const MAX_ATTACK_S  = 3.0;
const MAX_RELEASE_S = 2.5;

function formatSlotDuration(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = (secs % 60).toFixed(2);
  return m > 0 ? `${m}:${s.padStart(5, '0')}` : `${s}s`;
}

function SlotWaveform({ slot, sample }: { slot: SoundSlot; sample: SampleEntry | null }) {
  const canvasRef      = useRef<HTMLCanvasElement>(null);
  const grainOffsetRef = useRef(0);   // 0–1 fraction of the window where grain starts
  const rafRef         = useRef(0);
  const lastTimeRef    = useRef<number | null>(null);

  // Keep latest props in refs so the stable draw callback always sees current values
  const slotRef   = useRef(slot);
  const sampleRef = useRef(sample);
  slotRef.current   = slot;
  sampleRef.current = sample;

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const W = canvas.offsetWidth;
    const H = canvas.offsetHeight;
    if (W === 0 || H === 0) return;
    canvas.width  = W;
    canvas.height = H;

    const ctx2d = canvas.getContext('2d');
    if (!ctx2d) return;
    ctx2d.clearRect(0, 0, W, H);

    const sl  = slotRef.current;
    const smp = sampleRef.current;
    if (!smp) return;

    const audio = smp.audioData;
    const total = audio.length;

    // ── start / end window ──────────────────────────────────────────────────
    const startIdx = Math.floor((sl.start / 1023) * total);
    const endIdx   = Math.max(startIdx + 1,
                              Math.min(total, Math.ceil((sl.end / 1023) * total)));
    const winLen   = endIdx - startIdx;
    if (winLen <= 0) return;

    // ── crush ───────────────────────────────────────────────────────────────
    const hasCrush = sl.crush > 0;
    const bits     = hasCrush ? Math.max(1, Math.round(8 - (sl.crush / 127) * 6)) : 16;
    const step     = 2 / Math.pow(2, bits);

    // ── grain ───────────────────────────────────────────────────────────────
    const winDurSec  = winLen / MG_SAMPLE_RATE;
    const grainDur   = sl.loopLength > 0
      ? (sl.loopLength / 127) * Math.min(winDurSec, 2.0)
      : 0;
    const grainFrac  = grainDur > 0 ? Math.min(1, grainDur / winDurSec) : 0;
    const numBlocks  = Math.max(1, Math.floor(W / SW_BLOCK_SLOT));

    // Grain window position (0–1), animated by shift
    const gOff = grainFrac > 0 ? grainOffsetRef.current : 0;
    const gEnd = gOff + grainFrac; // may exceed 1 → wraps

    // Helper: is block b inside the (possibly wrapped) grain window?
    const inGrainWindow = (b: number) => {
      if (grainFrac <= 0) return false;
      const bFrac = b / numBlocks;
      return gEnd <= 1
        ? bFrac >= gOff && bFrac < gEnd
        : bFrac >= gOff || bFrac < (gEnd - 1);
    };

    // Grain tint background (handles wrap)
    if (grainFrac > 0) {
      ctx2d.fillStyle = 'rgba(255, 160, 50, 0.07)';
      if (gEnd <= 1) {
        ctx2d.fillRect(gOff * W, 0, grainFrac * W, H);
      } else {
        ctx2d.fillRect(gOff * W, 0, (1 - gOff) * W, H);
        ctx2d.fillRect(0,        0, (gEnd - 1)  * W, H);
      }
    }

    // ── waveform blocks ─────────────────────────────────────────────────────
    const halfH    = H / 2;
    const blockLen = winLen / numBlocks;

    for (let b = 0; b < numBlocks; b++) {
      const bStart = startIdx + Math.floor(b * blockLen);
      const bEnd   = startIdx + Math.min(winLen, Math.floor((b + 1) * blockLen));
      let peak = 0;
      for (let i = bStart; i < bEnd; i++) {
        let s = audio[i];
        if (hasCrush) s = Math.round(s / step) * step;
        const abs = Math.abs(s);
        if (abs > peak) peak = abs;
      }

      const inGrain = inGrainWindow(b);
      const alpha   = grainFrac > 0 ? (inGrain ? 0.85 : 0.2) : 0.72;
      ctx2d.fillStyle = inGrain
        ? `rgba(255, 160, 50, ${alpha})`
        : `rgba(85, 136, 255, ${alpha})`;

      const halfBar = Math.max(1, Math.round(peak * halfH));
      ctx2d.fillRect(b * SW_BLOCK_SLOT, halfH - halfBar, SW_BLOCK_W, halfBar * 2);
    }

    // ── attack / release envelope overlay ───────────────────────────────────
    if (sl.attack > 0 || sl.release > 0) {
      const attackSecs  = (sl.attack  / 127) * MAX_ATTACK_S;
      const releaseSecs = (sl.release / 127) * MAX_RELEASE_S;
      const envTotal    = attackSecs + releaseSecs;
      const envScale    = envTotal > winDurSec ? winDurSec / envTotal : 1;
      const attackX     = (attackSecs  * envScale / winDurSec) * W;
      const releaseX    = W - (releaseSecs * envScale / winDurSec) * W;

      ctx2d.beginPath();
      ctx2d.moveTo(0, H);
      ctx2d.lineTo(attackX, 0);
      ctx2d.lineTo(releaseX, 0);
      ctx2d.lineTo(W, H);
      ctx2d.closePath();
      ctx2d.fillStyle   = 'rgba(255,255,255,0.05)';
      ctx2d.fill();

      ctx2d.beginPath();
      ctx2d.moveTo(0, H);
      ctx2d.lineTo(attackX, 0);
      ctx2d.lineTo(releaseX, 0);
      ctx2d.lineTo(W, H);
      ctx2d.strokeStyle = 'rgba(255,255,255,0.22)';
      ctx2d.lineWidth   = 1;
      ctx2d.stroke();
    }
  }, []); // stable — reads via refs

  // Set up ResizeObserver once on mount
  useLayoutEffect(() => {
    draw();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(draw);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [draw]);

  // Shift animation: scan the grain window across the waveform
  useEffect(() => {
    cancelAnimationFrame(rafRef.current);
    lastTimeRef.current = null;

    const shiftRate = (slot.shiftSpeed - 128) / 128; // −1 to +1

    if (slot.loopLength === 0 || shiftRate === 0) {
      // No grain or no shift — reset to start and do a single static draw
      grainOffsetRef.current = 0;
      draw();
      return;
    }

    // Speed: ±0.4 window-widths per second at max shift (full traversal ≈ 2.5 s)
    const speed = shiftRate * 0.4;

    const tick = (now: number) => {
      if (lastTimeRef.current !== null) {
        const dt = (now - lastTimeRef.current) / 1000;
        grainOffsetRef.current = ((grainOffsetRef.current + speed * dt) % 1 + 1) % 1;
      }
      lastTimeRef.current = now;
      draw();
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [slot.loopLength, slot.shiftSpeed, draw]);

  // Redraw on all other param / sample changes (non-animated ones)
  useEffect(() => { draw(); }, [slot, sample, draw]);

  // Effective duration = window length adjusted for rate
  const duration = sample ? (() => {
    const total    = sample.audioData.length;
    const startIdx = Math.floor((slot.start / 1023) * total);
    const endIdx   = Math.max(startIdx + 1,
                              Math.min(total, Math.ceil((slot.end / 1023) * total)));
    return ((endIdx - startIdx) / MG_SAMPLE_RATE) / (slot.rate / 877);
  })() : null;

  return (
    <div className="slot-waveform-wrap">
      <canvas ref={canvasRef} className="slot-waveform-canvas" />
      {duration !== null && (
        <span className="slot-duration">{formatSlotDuration(duration)}</span>
      )}
    </div>
  );
}

// ─── Slot card ────────────────────────────────────────────────────────────────

function SlotCard({
  index, slot, onChange, samples, isPlaying, isSelected, onPlay, onStop, onSelect,
}: {
  index:      number;
  slot:       SoundSlot;
  onChange:   (patch: Partial<SoundSlot>) => void;
  samples:    SampleEntry[];
  isPlaying:  boolean;
  isSelected: boolean;
  onPlay:     (index: number) => void;
  onStop:     () => void;
  onSelect:   () => void;
}) {
  const flags            = getSettingFlags(slot.setting);
  const currentInLibrary = samples.some((s) => s.name === slot.sampleName);

  return (
    <div
      className={`slot-card${isSelected ? ' slot-card--selected' : ''}`}
      onClick={onSelect}
    >
      <div className="slot-header">
        <span className="slot-num">{index + 1}</span>
        <div className="slot-sample">
          <select
            className="slot-sample-select"
            value={currentInLibrary ? slot.sampleName : ''}
            onChange={(e) => { if (e.target.value) onChange({ sampleName: e.target.value }); }}
          >
            <option value="">—</option>
            {[...samples].sort((a, b) => a.name.localeCompare(b.name)).map((s) => (
              <option key={s.id} value={s.name}>{s.name}</option>
            ))}
          </select>
        </div>
        <button
          className={`slot-play-btn ${isPlaying ? 'slot-play-btn--on' : ''}`}
          onClick={isPlaying ? onStop : () => onPlay(index)}
          disabled={!currentInLibrary}
          title={isPlaying ? 'Stop preview' : 'Preview sound'}
        >
          {isPlaying ? '⏹' : '▶'}
        </button>
      </div>

      <div className="slot-params">
        {PARAMS_STANDARD.map((p) => (
          <ParamSlider
            key={p.key}
            label={p.label}
            value={slot[p.key] as number}
            min={p.key === 'end' ? slot.start : p.min}
            max={p.max}
            center={p.center}
            hint={p.hint}
            format={PARAM_FORMAT[p.key]}
            onChange={(v) => onChange({ [p.key]: v })}
          />
        ))}
        <div className="slot-params-divider">granular</div>
        {PARAMS_GRANULAR.map((p) => (
          <ParamSlider
            key={p.key}
            label={p.label}
            value={slot[p.key] as number}
            min={p.min}
            max={p.max}
            center={p.center}
            hint={p.hint}
            format={PARAM_FORMAT[p.key]}
            onChange={(v) => onChange({ [p.key]: v })}
          />
        ))}
      </div>

      <div className="slot-flags">
        {FLAGS.map((f) => (
          <FlagToggle
            key={f.key}
            label={f.label}
            active={flags[f.key]}
            onClick={() => onChange({ setting: slot.setting ^ f.bit })}
          />
        ))}
        <button
          className="rand-btn"
          title="Randomize all parameters"
          onClick={() => { onStop(); onChange(randomizeSlot()); }}
        >
          RAND
        </button>
      </div>

      <SlotWaveform
        slot={slot}
        sample={samples.find((s) => s.name === slot.sampleName) ?? null}
      />
    </div>
  );
}

// ─── Import preset file ───────────────────────────────────────────────────────

function ImportPresetButton({ bank, preset }: { bank: number; preset: number }) {
  const { loadPresetFile } = useStore();
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const data = new Uint8Array(await file.arrayBuffer());
    try {
      loadPresetFile(bank, preset, data);
    } catch (err) {
      alert(`Failed to load preset: ${err instanceof Error ? err.message : err}`);
    }
    e.target.value = '';
  };

  return (
    <>
      <input ref={inputRef} type="file" accept=".txt,.TXT" className="sr-only" onChange={handleFile} />
      <button className="btn btn-import" onClick={() => inputRef.current?.click()}>
        Import .TXT
      </button>
    </>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function PresetEditor() {
  const { activeBank, activePreset, getPreset, updateSlot, samples } = useStore();
  const slots = getPreset(activeBank, activePreset);

  const [playingSlot, setPlayingSlot]   = useState<number | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null);
  const audioRef      = useRef<AudioState | null>(null);
  // Always holds the latest slot state for the grain scheduler to read
  const activeSlotRef = useRef<SoundSlot | null>(null);
  // Copy/paste clipboard — not render state
  const copiedSlotRef = useRef<SoundSlot | null>(null);

  // Stable refs so the keydown handler never goes stale
  const selectedSlotRef = useRef(selectedSlot);
  selectedSlotRef.current = selectedSlot;
  const slotsRef = useRef(slots);
  slotsRef.current = slots;
  const activeBankRef = useRef(activeBank);
  activeBankRef.current = activeBank;
  const activePresetRef = useRef(activePreset);
  activePresetRef.current = activePreset;

  // ── Stop ────────────────────────────────────────────────────────────────────

  const stopPreview = useCallback(() => {
    const state = audioRef.current;
    if (state) {
      if (state.timerId !== null) clearTimeout(state.timerId);
      if (state.src) { try { state.src.stop(); } catch { /* ok */ } }
      state.ctx.close();
      audioRef.current = null;
    }
    activeSlotRef.current = null;
    setPlayingSlot(null);
  }, []);

  // Stop audio when navigating away from this tab
  useEffect(() => () => stopPreview(), [stopPreview]);

  // Ctrl+C / Ctrl+V / Ctrl+P copy-paste between slot cards
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

      if (e.key === 'c') {
        const idx = selectedSlotRef.current;
        if (idx !== null) copiedSlotRef.current = { ...slotsRef.current[idx] };
      }
      if (e.key === 'v' || e.key === 'p') {
        const idx = selectedSlotRef.current;
        if (idx !== null && copiedSlotRef.current !== null) {
          e.preventDefault();
          updateSlot(activeBankRef.current, activePresetRef.current, idx, copiedSlotRef.current);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [updateSlot]); // updateSlot is stable (Zustand action)

  // ── Grain scheduler ──────────────────────────────────────────────────────────
  // Declared with useCallback so it can reference itself via a stable ref.

  const scheduleGrainsRef = useRef<() => void>(() => {});

  const scheduleGrains = useCallback(() => {
    const state = audioRef.current;
    const slot  = activeSlotRef.current;
    if (!state || !slot) return;

    const { ctx, buf, gainNode } = state;
    const { startPos, endPos }   = slotWindow(slot, buf.duration);
    const windowDur              = endPos - startPos;
    const grainDur = Math.max(0.005, (slot.loopLength / 127) * Math.min(windowDur, 2.0));

    // shiftPerGrain: at max shift (±1) the head moves one full grain per cycle
    const shiftRate     = (slot.shiftSpeed - 128) / 128;
    const shiftPerGrain = shiftRate * grainDur;

    const until = ctx.currentTime + GRAIN_LOOKAHEAD;

    while (state.nextTime < until) {
      // Clamp/wrap grain head to window
      if (state.grainPos > endPos - grainDur) state.grainPos = startPos;
      if (state.grainPos < startPos)          state.grainPos = Math.max(startPos, endPos - grainDur);
      const gStart = Math.max(startPos, Math.min(endPos - grainDur, state.grainPos));

      const src = ctx.createBufferSource();
      src.buffer             = buf;
      src.playbackRate.value = slot.rate / 877;
      src.connect(gainNode);   // grain → gainNode → crushNode → destination
      src.start(Math.max(ctx.currentTime, state.nextTime), gStart, grainDur);

      state.nextTime += grainDur;
      state.grainPos += shiftPerGrain;
    }

    state.timerId = setTimeout(scheduleGrainsRef.current, GRAIN_INTERVAL);
  }, []);

  // Keep the ref in sync so the recursive setTimeout always calls latest version
  scheduleGrainsRef.current = scheduleGrains;

  // ── Recreate source (start/end/grain changes) ────────────────────────────────

  const recreateSource = useCallback((slot: SoundSlot) => {
    const state = audioRef.current;
    if (!state) return;

    activeSlotRef.current = slot;

    if (slot.loopLength > 0) {
      // Switch to / restart grain mode
      if (state.timerId !== null) clearTimeout(state.timerId);
      if (state.src) { try { state.src.stop(); } catch { /* ok */ } }
      const { startPos } = slotWindow(slot, state.buf.duration);
      audioRef.current = {
        ...state,
        src: null, startedAt: 0, offset: 0,
        grainPos: startPos, nextTime: state.ctx.currentTime, timerId: null,
      };
      scheduleGrains();
    } else {
      // Switch to / restart linear mode
      if (state.timerId !== null) clearTimeout(state.timerId);
      const { ctx, buf, gainNode } = state;
      const elapsed    = state.src ? (ctx.currentTime - state.startedAt) : 0;
      const currentPos = state.offset + elapsed;
      if (state.src) { try { state.src.stop(); } catch { /* ok */ } }

      const { startPos, endPos } = slotWindow(slot, buf.duration);
      const flags = getSettingFlags(slot.setting);
      const resumePos = Math.max(startPos, Math.min(endPos - 0.001, currentPos));

      const newSrc = ctx.createBufferSource();
      newSrc.buffer             = buf;
      newSrc.playbackRate.value = slot.rate / 877;
      if (flags.repeat) { newSrc.loop = true; newSrc.loopStart = startPos; newSrc.loopEnd = endPos; }
      newSrc.connect(gainNode);   // src → gainNode → crushNode → destination
      newSrc.start(0, resumePos, newSrc.loop ? undefined : endPos - resumePos);
      newSrc.onended = () => {
        if (audioRef.current?.src === newSrc) {
          ctx.close(); audioRef.current = null; setPlayingSlot(null);
        }
      };
      audioRef.current = {
        ...state,
        src: newSrc, startedAt: ctx.currentTime, offset: resumePos,
        grainPos: 0, nextTime: 0, timerId: null,
      };
    }
  }, [scheduleGrains]);

  // ── Apply live parameter changes while playing ───────────────────────────────

  const applyLiveUpdate = useCallback((slot: SoundSlot, patch: Partial<SoundSlot>) => {
    const state = audioRef.current;
    if (!state) return;

    // Always update slot ref — grain scheduler picks up shiftSpeed/rate changes automatically
    activeSlotRef.current = slot;

    // In grain mode src is null; rate updates take effect on next scheduled grain
    if ('rate' in patch && state.src) {
      state.src.playbackRate.value = slot.rate / 877;
    }
    if ('crush' in patch) {
      // crushNode is always the AudioWorkletNode (gainNode is stored separately)
      state.crushNode.parameters.get('bits')!.value = crushBits(slot.crush);
    }
    if ('start' in patch || 'end' in patch || 'loopLength' in patch) {
      recreateSource(slot);
    }
  }, [recreateSource]);

  // ── onChange wrapper: updates store + live audio ─────────────────────────────

  const handleSlotChange = useCallback((slotIndex: number, patch: Partial<SoundSlot>) => {
    updateSlot(activeBank, activePreset, slotIndex, patch);

    if (playingSlot === slotIndex && audioRef.current) {
      const currentSlot = getPreset(activeBank, activePreset)[slotIndex];
      applyLiveUpdate({ ...currentSlot, ...patch }, patch);
    }
  }, [activeBank, activePreset, updateSlot, playingSlot, getPreset, applyLiveUpdate]);

  // ── Start playback ───────────────────────────────────────────────────────────

  const playPreview = useCallback(async (slotIndex: number) => {
    stopPreview();

    const slot   = getPreset(activeBank, activePreset)[slotIndex];
    const sample = samples.find((s) => s.name === slot.sampleName);
    if (!sample) return;

    const ctx = new AudioContext();
    await loadBitCrushWorklet(ctx);

    const buf = ctx.createBuffer(1, sample.audioData.length, MG_SAMPLE_RATE);
    buf.copyToChannel(sample.audioData, 0);

    const crushNode = new AudioWorkletNode(ctx, 'bit-crush-processor');
    crushNode.parameters.get('bits')!.value = crushBits(slot.crush);
    crushNode.connect(ctx.destination);

    const { startPos, endPos } = slotWindow(slot, buf.duration);

    // Attack envelope on a GainNode before the crush
    const attackSecs = (slot.attack / 127) * 0.5;
    const gain       = ctx.createGain();
    if (attackSecs > 0.005) {
      gain.gain.setValueAtTime(0, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(1, ctx.currentTime + attackSecs);
    }
    gain.connect(crushNode);

    activeSlotRef.current = slot;

    if (slot.loopLength > 0) {
      // ── Grain mode: scheduled grain engine ──────────────────────────────
      // Audio chain: each grain → gainNode → crushNode → destination
      audioRef.current = {
        ctx, gainNode: gain, crushNode, buf,
        src: null, startedAt: 0, offset: 0,
        grainPos: startPos, nextTime: ctx.currentTime, timerId: null,
      };
      scheduleGrains();
    } else {
      // ── Linear mode ─────────────────────────────────────────────────────
      // Audio chain: src → gainNode → crushNode → destination
      const flags = getSettingFlags(slot.setting);
      const src   = ctx.createBufferSource();
      src.buffer             = buf;
      src.playbackRate.value = slot.rate / 877;
      if (flags.repeat) { src.loop = true; src.loopStart = startPos; src.loopEnd = endPos; }
      src.connect(gain);
      src.start(0, startPos, src.loop ? undefined : endPos - startPos);
      src.onended = () => {
        if (audioRef.current?.src === src) {
          ctx.close(); audioRef.current = null; setPlayingSlot(null);
        }
      };
      audioRef.current = {
        ctx, gainNode: gain, crushNode, buf,
        src, startedAt: ctx.currentTime, offset: startPos,
        grainPos: 0, nextTime: 0, timerId: null,
      };
    }

    setPlayingSlot(slotIndex);
  }, [activeBank, activePreset, getPreset, samples, stopPreview, scheduleGrains]);

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="preset-editor">
      <aside className="preset-sidebar">
        <div className="sidebar-label dimmed">BANK · PRESET</div>
        <BankPresetGrid />
      </aside>

      <div className="preset-main">
        <div className="preset-toolbar">
          <span className="preset-title">
            Bank <strong>{activeBank}</strong> · Preset <strong>{activePreset + 1}</strong>
          </span>
          <ImportPresetButton bank={activeBank} preset={activePreset} />
        </div>

        <div className="slots-row">
          {slots.map((slot, i) => (
            <SlotCard
              key={i}
              index={i}
              slot={slot}
              samples={samples}
              isPlaying={playingSlot === i}
              isSelected={selectedSlot === i}
              onPlay={(idx) => { setSelectedSlot(idx); playPreview(idx); }}
              onStop={stopPreview}
              onSelect={() => setSelectedSlot(i)}
              onChange={(patch) => handleSlotChange(i, patch)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
