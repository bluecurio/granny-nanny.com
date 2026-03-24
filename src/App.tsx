import './index.css';
import './App.css';
import { useStore, type Tab } from './store';
import SampleLibrary from './components/SampleLibrary';
import PresetEditor from './components/PresetEditor';
import ExportPanel from './components/ExportPanel';

const TABS: { id: Tab; label: string }[] = [
  { id: 'samples', label: 'SAMPLES' },
  { id: 'presets', label: 'PRESETS' },
  { id: 'export',  label: 'EXPORT'  },
];

export default function App() {
  const { activeTab, setActiveTab } = useStore();

  return (
    <div className="app">
      <header className="app-header">
        <span className="app-logo">granny<span className="app-logo-accent">nanny</span></span>
        <nav className="app-nav">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`nav-btn ${activeTab === t.id ? 'nav-btn--active' : ''}`}
              onClick={() => setActiveTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <span className="app-sub dimmed">microGranny 2.0 preset tool</span>
      </header>

      <main className="app-main">
        {activeTab === 'samples' && <SampleLibrary />}
        {activeTab === 'presets' && <PresetEditor />}
        {activeTab === 'export'  && <ExportPanel />}
      </main>
    </div>
  );
}
