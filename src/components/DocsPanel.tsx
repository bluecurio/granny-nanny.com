import './DocsPanel.css';

// ── Update this after uploading zips to S3 ────────────────────────────────────
// e.g. 'https://granny-nanny-assets.s3.us-east-1.amazonaws.com/sample-packs'
const SAMPLE_PACK_BASE = 'https://YOUR-BUCKET.s3.amazonaws.com/sample-packs';

export default function DocsPanel() {
  return (
    <div className="docs-panel">

      <section className="docs-section">
        <h2 className="docs-heading">About this site</h2>
        <p>
          <strong>granny-nanny.com</strong> is a browser-based tool for preparing samples and presets for the{' '}
          <a href="https://bastl-instruments.com/instruments/microgranny" target="_blank" rel="noreferrer">
            Bastl Instruments microGranny 2.0</a> granular sampler. It lets you
          import or record audio, convert it to the 22&thinsp;kHz mono WAV format the device
          expects, assign the two-character SD card names, edit all six slots of a preset
          file (rate, grain, crush, start, end, shift, attack, release, and mode flags),
          and export everything as a ready-to-copy ZIP.
        </p>
        <p>
          The preset encoder was built by reading the open-source microGranny firmware
          directly and replicating its bit-packing scheme. We verified the implementation
          against a set of real preset files with a roundtrip test (decode → re-encode →
          byte-compare), but because the firmware is complex and hardware behaviour can vary
          by revision, <strong>the results on this site may differ slightly from your
          device</strong>. For example, 
          <ul className="stuff">
            <li><u>bitcrush</u> effect on the MG sounds much better due to distortion</li>
            <li>the <u>grain shift</u> & speed are an estimation</li>
            <li><u>attack</u> and <u>release</u> are also estimations</li>
          </ul> 
        </p>
        <p>  
          We've done our best to get it right — use your ears as the final judge.
        </p>
      </section>

      <section className="docs-section">
        <h2 className="docs-heading">microGranny 2.0 resources</h2>
        <ul className="docs-links">
          <li>
            <a href="https://bastl-instruments.com/instruments/microgranny" target="_blank" rel="noreferrer">
              Bastl Instruments — microGranny 2.0
            </a>
            {' '}— the official product page, firmware downloads, and support.
          </li>
          <li>
            <a href="https://bastl-instruments.com/content/files/manual-microgranny-2.pdf" target="_blank" rel="noreferrer">
              microGranny 2.0 Manual (PDF)
            </a>
            {' '}— the full parameter reference, preset file format details, and usage guide
            straight from Bastl.
          </li>
          <li>
            <a href="https://modulargrid.net/p/bastl-instruments-microgranny-2-" target="_blank" rel="noreferrer">
              ModularGrid — microGranny 2.0
            </a>
            {' '}— specs, user patches, and community notes for Eurorack context.
          </li>
        </ul>
      </section>

      <section className="docs-section">
        <h2 className="docs-heading">Original microGranny sample packs</h2>
        <p>
          The original factory sample packs shipped with each hardware revision, as provided
          by Bastl Instruments. Download and extract directly to your SD card.
        </p>
        <ul className="docs-links">
          <li>
            <a href={`${SAMPLE_PACK_BASE}/ORIGINAL_mg_bank_2_0.zip`} download>
              microGranny 2.0 — factory sample bank
            </a>
          </li>
          <li>
            <a href={`${SAMPLE_PACK_BASE}/ORIGINAL_mg_bank_2_3.zip`} download>
              microGranny 2.3 — factory sample bank
            </a>
          </li>
          <li>
            <a href={`${SAMPLE_PACK_BASE}/ORIGINAL_mg_bank_2_5.zip`} download>
              microGranny 2.5 — factory sample bank
            </a>
          </li>
        </ul>
      </section>

    </div>
  );
}
