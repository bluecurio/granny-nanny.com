# granny-nanny

A browser-based preparation tool for the [Bastl Instruments microGranny 2.0](https://bastl-instruments.com/instruments/microgranny) granular sampler.

**[granny-nanny.com](https://granny-nanny.com)**

---

## What it does

The microGranny stores samples as 22 kHz mono WAV files with strict two-character names (`A1.wav`, `BD.wav`, etc.) and reads preset configuration from plain-text `.TXT` files with a specific bit-packed binary format. Managing this by hand is tedious. granny-nanny handles it in the browser — no install, no server.

| Tab | What you can do |
|---|---|
| **Samples** | Drop in any audio file (WAV, MP3, FLAC, OGG, AIFF, M4A). The app resamples to 22 kHz mono, lets you assign the two-character SD card name, preview playback with a waveform display, and set bit depth (16 or 8-bit). |
| **Presets** | Edit all six slots across any of the 10×6 bank/preset grid. Each slot has the full parameter set: rate, crush, start, end, attack, release, grain size, and grain shift. Live audio preview with real-time slider feedback. Copy/paste slots with Ctrl+C / Ctrl+V. |
| **Export** | Download a ZIP containing all your converted WAV files and preset `.TXT` files, ready to drop onto the SD card. |
| **Docs** | Reference links, device notes, and original factory sample pack downloads. |

---

## Local development

```bash
npm install
npm run dev
```

```bash
npm run build    # TypeScript check + Vite production build → dist/
npm run preview  # Preview the production build locally
```

**Stack:** React 18 · TypeScript · Vite · Zustand

---

## Project structure

```
src/
  audio/
    resample.ts       # Decodes any audio file → 22 050 Hz mono Float32Array
    wavEncoder.ts     # Encodes Float32Array → 16-bit or 8-bit WAV Blob
    recorder.ts       # MediaRecorder wrapper for mic input
  codec/
    presetCodec.ts    # Encodes/decodes the microGranny .TXT preset format
    bitPack.ts        # Bit-packing helpers matching the MG firmware
    verify.ts         # Round-trip (decode → re-encode → byte-compare) tests
  components/
    SampleLibrary     # Sample import, naming, waveform preview, export list
    PresetEditor      # Slot editor, live audio preview, grain scheduler
    ExportPanel       # ZIP assembly and download
    DocsPanel         # Documentation and resource links
  store/
    index.ts          # Zustand global store (samples, presets, active tab)
```

---

## Preset format

The microGranny preset `.TXT` files are **not** human-readable text — they contain raw binary data with 12 bytes per slot × 6 slots = 72 bytes, bit-packed to match the device firmware. The codec here was built by reading the open-source MG firmware directly and verified with a round-trip test against real preset files.

Parameters per slot:

| Parameter | Range | Notes |
|---|---|---|
| Rate | 0–1023 | 877 = original pitch (1.00×) |
| Crush | 0–127 | Bit-depth reduction |
| Start | 0–1023 | Playback start position |
| End | 0–1023 | Playback end position (≥ start) |
| Attack | 0–127 | Amplitude envelope attack |
| Release | 0–127 | Amplitude envelope release |
| Grain | 0–127 | Grain loop length |
| Shift | 0–255 | Grain shift speed (128 = no shift) |
| Flags | bits | TUNED · LEGATO · REPEAT · SYNC |

---

## Deployment

Hosted on AWS Amplify. Build spec is in `amplify.yml`:

- **Build:** `npm ci` → `npm run build`
- **Artifact:** `dist/`

### Sample pack downloads

The original factory zip files (285 MB, 74 MB, 77 MB) are too large for git and are served from S3. To update the download URLs, change `SAMPLE_PACK_BASE` in `src/components/DocsPanel.tsx`.

The zip files themselves live at:
```
s3://granny-nanny-assets/sample-packs/
  ORIGINAL_mg_bank_2_0.zip
  ORIGINAL_mg_bank_2_3.zip
  ORIGINAL_mg_bank_2_5.zip
```

---

## Notes and caveats

The preset encoder replicates the MG firmware's bit-packing and has been verified against real preset files. However:

- The **bit-crush** effect on hardware sounds noticeably different due to analog distortion
- **Grain shift** speed and the **attack/release** envelope timings are approximations
- Behaviour can vary between firmware revisions

Use your ears as the final judge.

---

Built by [Daniel Renfro](https://daniel-renfro.com)
