import { useEffect } from 'react';
import './index.css';
import './App.css';
import deviceImg from './images/35123.f.jpg';
import { useStore, type Tab } from './store';
import SampleLibrary from './components/SampleLibrary';
import PresetEditor from './components/PresetEditor';
import ExportPanel from './components/ExportPanel';
import DocsPanel from './components/DocsPanel';

const TABS: { id: Tab; label: string }[] = [
  { id: 'samples', label: 'SAMPLES' },
  { id: 'presets', label: 'PRESETS' },
  { id: 'export',  label: 'EXPORT'  },
  { id: 'docs',    label: 'DOCS'    },
];

export default function App() {
  const { activeTab, setActiveTab } = useStore();

  useEffect(() => {
    const onHashChange = () => {
      const hash = window.location.hash.slice(1) as Tab;
      const valid: Tab[] = ['samples', 'presets', 'export', 'docs'];
      setActiveTab(valid.includes(hash) ? hash : 'samples');
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [setActiveTab]);

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
        <span className="app-sub dimmed"></span>
        <img src={deviceImg} alt="microGranny 2.0" className="app-device-img" />
      </header>

      <main className="app-main">
        {activeTab === 'samples' && <SampleLibrary />}
        {activeTab === 'presets' && <PresetEditor />}
        {activeTab === 'export'  && <ExportPanel />}
        {activeTab === 'docs'    && <DocsPanel />}
      </main>

      <footer className="app-footer">
        built by&nbsp;<a href="https://daniel-renfro.com" target="_blank" rel="noreferrer">Daniel Renfro</a>
        <span className="app-version">v1.0</span>
      </footer>
    </div>
  );
}
