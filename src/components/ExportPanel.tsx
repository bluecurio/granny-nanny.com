import { useState, useEffect, useRef } from 'react';
import JSZip from 'jszip';
import { useStore } from '../store';
import { encodePreset, presetFilename } from '../codec/presetCodec';
import { encodeWav } from '../audio/wavEncoder';
import { MG_SAMPLE_RATE } from '../audio/resample';
import './ExportPanel.css';

async function buildZip(
  samples: ReturnType<typeof useStore.getState>['samples'],
  presets: ReturnType<typeof useStore.getState>['presets'],
  getPreset: ReturnType<typeof useStore.getState>['getPreset'],
  checkedSamples: Set<string>,
  checkedPresets: Set<string>,
): Promise<Blob> {
  const zip = new JSZip();

  for (const sample of samples) {
    if (!checkedSamples.has(sample.id)) continue;
    const wav = encodeWav(sample.audioData, MG_SAMPLE_RATE, sample.bitDepth);
    zip.file(`${sample.name}.WAV`, wav);
  }

  const editedKeys = Object.keys(presets);
  for (const key of editedKeys) {
    if (!checkedPresets.has(key)) continue;
    const m = /^P(\d)([1-6])\.TXT$/i.exec(key);
    if (!m) continue;
    const bank = parseInt(m[1], 10);
    const preset = parseInt(m[2], 10) - 1;
    const slots = getPreset(bank, preset);
    const binary = encodePreset(slots);
    zip.file(key, binary);
  }

  return zip.generateAsync({ type: 'blob' });
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Select-all checkbox (supports indeterminate) ─────────────────────────────

function SelectAllCheckbox({
  checked,
  indeterminate,
  onChange,
}: {
  checked: boolean;
  indeterminate: boolean;
  onChange: (checked: boolean) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      className="export-checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
    />
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ExportPanel() {
  const { samples, presets, getPreset } = useStore();

  const editedPresets = Object.keys(presets).sort();

  const [checkedSamples, setCheckedSamples] = useState<Set<string>>(
    () => new Set(samples.map((s) => s.id)),
  );
  const [checkedPresets, setCheckedPresets] = useState<Set<string>>(
    () => new Set(editedPresets),
  );
  const [building, setBuilding] = useState(false);

  // Keep checked sets in sync as items are added or removed
  useEffect(() => {
    setCheckedSamples((prev) => {
      const currentIds = new Set(samples.map((s) => s.id));
      const next = new Set([...prev].filter((id) => currentIds.has(id)));
      for (const id of currentIds) if (!prev.has(id)) next.add(id);
      return next;
    });
  }, [samples]);

  useEffect(() => {
    setCheckedPresets((prev) => {
      const current = new Set(editedPresets);
      const next = new Set([...prev].filter((k) => current.has(k)));
      for (const k of current) if (!prev.has(k)) next.add(k);
      return next;
    });
  }, [editedPresets.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Sample checkbox helpers ──────────────────────────────────────────────
  const allSamplesChecked  = samples.length > 0 && checkedSamples.size === samples.length;
  const someSamplesChecked = checkedSamples.size > 0 && checkedSamples.size < samples.length;

  const toggleSample = (id: string, on: boolean) =>
    setCheckedSamples((prev) => { const next = new Set(prev); on ? next.add(id) : next.delete(id); return next; });

  const toggleAllSamples = (on: boolean) =>
    setCheckedSamples(on ? new Set(samples.map((s) => s.id)) : new Set());

  // ── Preset checkbox helpers ──────────────────────────────────────────────
  const allPresetsChecked  = editedPresets.length > 0 && checkedPresets.size === editedPresets.length;
  const somePresetsChecked = checkedPresets.size > 0 && checkedPresets.size < editedPresets.length;

  const togglePreset = (key: string, on: boolean) =>
    setCheckedPresets((prev) => { const next = new Set(prev); on ? next.add(key) : next.delete(key); return next; });

  const toggleAllPresets = (on: boolean) =>
    setCheckedPresets(on ? new Set(editedPresets) : new Set());

  // ── Derived totals ───────────────────────────────────────────────────────
  const checkedWavBytes = samples
    .filter((s) => checkedSamples.has(s.id))
    .reduce((acc, s) => acc + 44 + s.audioData.length * (s.bitDepth / 8), 0);

  const handleExport = async () => {
    setBuilding(true);
    try {
      const blob = await buildZip(samples, presets, getPreset, checkedSamples, checkedPresets);
      triggerDownload(blob, 'microgranny-sd.zip');
    } catch (e) {
      alert(`Export failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBuilding(false);
    }
  };

  const checkedCount = checkedSamples.size + checkedPresets.size;

  return (
    <div className="export-panel">

      <div className="export-instructions">
        <h2 className="export-heading">How to use</h2>
        <ol className="export-steps">
          <li>Select the samples and presets you would like to export.</li>
          <li>Click <strong>Download SD card .zip</strong> below.</li>
          <li>Extract the zip — inside you'll find your <code>.WAV</code> and <code>.TXT</code> files.</li>
          <li>Copy the contents directly to the <strong>root directory</strong> of your SD card (not into a subfolder).</li>
          <li>Insert the card into the microGranny and power it on — your samples and presets will be ready to play.</li>
        </ol>
      </div>

      <div className="export-section">
        <h2 className="export-heading">WAV Samples</h2>
        {samples.length === 0 ? (
          <p className="dimmed">No samples loaded.</p>
        ) : (
          <table className="export-table">
            <thead>
              <tr>
                <th className="export-col-check">
                  <SelectAllCheckbox
                    checked={allSamplesChecked}
                    indeterminate={someSamplesChecked}
                    onChange={toggleAllSamples}
                  />
                </th>
                <th>Name</th>
                <th>Original file</th>
                <th>Duration</th>
                <th>Bit depth</th>
                <th>File size</th>
              </tr>
            </thead>
            <tbody>
              {samples.map((s) => {
                const bytes = 44 + s.audioData.length * (s.bitDepth / 8);
                const secs = s.audioData.length / MG_SAMPLE_RATE;
                const checked = checkedSamples.has(s.id);
                return (
                  <tr key={s.id} className={checked ? '' : 'export-row--unchecked'}>
                    <td className="export-col-check">
                      <input
                        type="checkbox"
                        className="export-checkbox"
                        checked={checked}
                        onChange={(e) => toggleSample(s.id, e.target.checked)}
                      />
                    </td>
                    <td className="mono bold">{s.name}.WAV</td>
                    <td className="dimmed">{s.originalFilename}</td>
                    <td className="dimmed">{secs.toFixed(2)}s</td>
                    <td className="dimmed">{s.bitDepth}-bit</td>
                    <td className="dimmed">{(bytes / 1024).toFixed(1)} KB</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td />
                <td colSpan={4} className="dimmed">
                  {checkedSamples.size} of {samples.length} selected
                </td>
                <td className="dimmed">{(checkedWavBytes / 1024).toFixed(1)} KB</td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      <div className="export-section">
        <div className="export-heading-row">
          <h2 className="export-heading">Preset Files</h2>
          {editedPresets.length > 0 && (
            <SelectAllCheckbox
              checked={allPresetsChecked}
              indeterminate={somePresetsChecked}
              onChange={toggleAllPresets}
            />
          )}
        </div>
        {editedPresets.length === 0 ? (
          <p className="dimmed">No presets edited.</p>
        ) : (
          <div className="export-preset-list">
            {editedPresets.map((key) => {
              const m = /^P(\d)([1-6])\.TXT$/i.exec(key);
              if (!m) return null;
              const bank = parseInt(m[1], 10);
              const pIdx = parseInt(m[2], 10) - 1;
              const slots = getPreset(bank, pIdx);
              const names = slots.map((s) => s.sampleName).join(' · ');
              const checked = checkedPresets.has(key);
              return (
                <div key={key} className={`export-preset-row ${checked ? '' : 'export-row--unchecked'}`}>
                  <input
                    type="checkbox"
                    className="export-checkbox"
                    checked={checked}
                    onChange={(e) => togglePreset(key, e.target.checked)}
                  />
                  <span className="mono bold">{presetFilename(bank, pIdx)}</span>
                  <span className="dimmed">{names}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <div className="export-actions">
        <button
          className="export-btn"
          disabled={checkedCount === 0 || building}
          onClick={handleExport}
        >
          {building ? 'Building…' : 'Download SD card .zip'}
        </button>
        {checkedCount === 0 && (
          <span className="dimmed export-hint">Select at least one file to export.</span>
        )}
      </div>
    </div>
  );
}
