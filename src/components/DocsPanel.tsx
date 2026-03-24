import './DocsPanel.css';

export default function DocsPanel() {
  return (
    <div className="docs-panel">

      <section className="docs-section">
        <h2 className="docs-heading">About this site</h2>
        <p>
          grannynanny is a browser-based tool for preparing samples and presets for the{' '}
          <strong>Bastl Instruments microGranny 2.0</strong> granular sampler. It lets you
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
          device</strong>. We've done our best to get it right — use your ears as the final
          judge.
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

    </div>
  );
}
