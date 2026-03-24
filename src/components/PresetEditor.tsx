import { useRef } from 'react';
import { useStore } from '../store';
import { type SoundSlot, SETTING_FLAG, getSettingFlags, presetFilename } from '../codec/presetCodec';
import './PresetEditor.css';

// ─── Parameter metadata ───────────────────────────────────────────────────────

const PARAMS: {
  key: keyof Omit<SoundSlot, 'sampleName' | 'setting'>;
  label: string;
  min: number;
  max: number;
  center?: number;
  hint?: string;
}[] = [
  { key: 'rate',       label: 'RATE',    min: 0,   max: 1023, center: 877, hint: '877 = original pitch' },
  { key: 'crush',      label: 'CRUSH',   min: 0,   max: 127,               hint: 'bit crush depth' },
  { key: 'start',      label: 'START',   min: 0,   max: 1023,              hint: 'playback start position' },
  { key: 'end',        label: 'END',     min: 0,   max: 1023,              hint: 'playback end position' },
  { key: 'loopLength', label: 'GRAIN',   min: 0,   max: 127,               hint: 'grain loop length' },
  { key: 'shiftSpeed', label: 'SHIFT',   min: 0,   max: 255,  center: 128, hint: '128 = no shift' },
  { key: 'attack',     label: 'ATTACK',  min: 0,   max: 127,               hint: 'envelope attack' },
  { key: 'release',    label: 'RELEASE', min: 0,   max: 127,               hint: 'envelope release' },
];

const FLAGS: { key: keyof ReturnType<typeof getSettingFlags>; label: string; bit: number }[] = [
  { key: 'tuned',     label: 'TUNED',  bit: SETTING_FLAG.TUNED     },
  { key: 'legato',    label: 'LEGATO', bit: SETTING_FLAG.LEGATO    },
  { key: 'repeat',    label: 'REPEAT', bit: SETTING_FLAG.REPEAT    },
  { key: 'sync',      label: 'SYNC',   bit: SETTING_FLAG.SYNC      },
  { key: 'randShift', label: 'RAND',   bit: SETTING_FLAG.RAND_SHIFT},
];

// ─── Bank / preset grid ───────────────────────────────────────────────────────

function BankPresetGrid() {
  const { activeBank, activePreset, setActivePreset, presets } = useStore();

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
            const key = presetFilename(bank, p);
            const active = activeBank === bank && activePreset === p;
            const hasData = !!presets[key];
            return (
              <button
                key={p}
                className={`bp-cell ${active ? 'bp-cell--active' : ''} ${hasData ? 'bp-cell--has-data' : ''}`}
                onClick={() => setActivePreset(bank, p)}
                title={`Bank ${bank}, Preset ${p + 1}`}
              />
            );
          })}
        </div>
      ))}
      <div className="bp-legend dimmed">
        <span className="bp-dot bp-dot--data" /> edited
      </div>
    </div>
  );
}

// ─── Slot editor ──────────────────────────────────────────────────────────────

function ParamSlider({
  label, value, min, max, center, hint,
  onChange,
}: {
  label: string; value: number; min: number; max: number;
  center?: number; hint?: string;
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
        {value}
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

function SlotCard({
  index, slot, onChange, sampleNames,
}: {
  index: number;
  slot: SoundSlot;
  onChange: (patch: Partial<SoundSlot>) => void;
  sampleNames: string[];
}) {
  const flags = getSettingFlags(slot.setting);

  const toggleFlag = (bit: number) => {
    onChange({ setting: slot.setting ^ bit });
  };

  const handleNameInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 2);
    onChange({ sampleName: v.padEnd(2, slot.sampleName[1] ?? '0') });
  };

  return (
    <div className="slot-card">
      <div className="slot-header">
        <span className="slot-num">{index + 1}</span>
        <div className="slot-sample">
          <input
            className="slot-name-input"
            value={slot.sampleName}
            maxLength={2}
            onChange={handleNameInput}
            spellCheck={false}
            list={`samples-list-${index}`}
          />
          {sampleNames.length > 0 && (
            <datalist id={`samples-list-${index}`}>
              {sampleNames.map((n) => <option key={n} value={n} />)}
            </datalist>
          )}
        </div>
      </div>

      <div className="slot-params">
        {PARAMS.map((p) => (
          <ParamSlider
            key={p.key}
            label={p.label}
            value={slot[p.key] as number}
            min={p.min}
            max={p.max}
            center={p.center}
            hint={p.hint}
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
            onClick={() => toggleFlag(f.bit)}
          />
        ))}
      </div>
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
  const sampleNames = samples.map((s) => s.name);

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
              sampleNames={sampleNames}
              onChange={(patch) => updateSlot(activeBank, activePreset, i, patch)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
