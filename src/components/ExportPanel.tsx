import { useState } from 'react';
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
): Promise<Blob> {
  const zip = new JSZip();

  // Encode each sample as a WAV at the correct name
  for (const sample of samples) {
    const wav = encodeWav(sample.audioData, MG_SAMPLE_RATE, sample.bitDepth);
    zip.file(`${sample.name}.WAV`, wav);
  }

  // Encode all presets — write only those that have been explicitly edited,
  // but always include banks/presets that are in the store.
  const editedKeys = Object.keys(presets);
  for (const key of editedKeys) {
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

// ─── Main component ───────────────────────────────────────────────────────────

export default function ExportPanel() {
  const { samples, presets, getPreset } = useStore();
  const [building, setBuilding] = useState(false);

  const editedPresets = Object.keys(presets).sort();
  const totalWavBytes = samples.reduce(
    (acc, s) => acc + 44 + s.audioData.length * (s.bitDepth / 8),
    0,
  );

  const handleExport = async () => {
    setBuilding(true);
    try {
      const blob = await buildZip(samples, presets, getPreset);
      triggerDownload(blob, 'microgranny-sd.zip');
    } catch (e) {
      alert(`Export failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBuilding(false);
    }
  };

  const hasSomething = samples.length > 0 || editedPresets.length > 0;

  return (
    <div className="export-panel">
      <div className="export-section">
        <h2 className="export-heading">WAV Samples</h2>
        {samples.length === 0 ? (
          <p className="dimmed">No samples loaded.</p>
        ) : (
          <table className="export-table">
            <thead>
              <tr>
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
                return (
                  <tr key={s.id}>
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
                <td colSpan={4} className="dimmed">Total</td>
                <td className="dimmed">{(totalWavBytes / 1024).toFixed(1)} KB</td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      <div className="export-section">
        <h2 className="export-heading">Preset Files</h2>
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
              return (
                <div key={key} className="export-preset-row">
                  <span className="mono bold">{presetFilename(bank, pIdx)}</span>
                  <span className="dimmed">{names}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="export-instructions">
        <h2 className="export-heading">How to use</h2>
        <ol className="export-steps">
          <li>Click <strong>Download SD card .zip</strong> below.</li>
          <li>Extract the zip — inside you'll find your <code>.WAV</code> and <code>.TXT</code> files.</li>
          <li>Copy the contents directly to the <strong>root directory</strong> of your SD card (not into a subfolder).</li>
          <li>Insert the card into the microGranny and power it on — your samples and presets will be ready to play.</li>
        </ol>
        <p className="export-note">
          Any standard SD card works. granny-nanny handles all the encoding automatically —
          samples are converted to 22&thinsp;kHz mono WAV and presets are written in the
          exact binary format the microGranny firmware expects.
        </p>
      </div>

      <div className="export-actions">
        <button
          className="export-btn"
          disabled={!hasSomething || building}
          onClick={handleExport}
        >
          {building ? 'Building…' : 'Download SD card .zip'}
        </button>
        {!hasSomething && (
          <span className="dimmed export-hint">Add samples or edit presets first.</span>
        )}
      </div>
    </div>
  );
}
