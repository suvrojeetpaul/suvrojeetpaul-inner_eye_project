import React, { useState, useEffect, useCallback } from 'react';
import './App.css';
import MedicalMesh from './MedicalMesh';

function App() {
  const [department, setDepartment] = useState(null);
  const [patientName, setPatientName] = useState("");
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [history, setHistory] = useState([]);
  const [activeTab, setActiveTab] = useState("HISTORY"); //
  const [logs, setLogs] = useState(["> SANCTUM_READY", "> WAITING_FOR_INVOCATION"]);

  const fetchHistory = useCallback(async () => {
    try {
      const res = await fetch('http://localhost:8000/patients');
      const data = await res.json();
      if (data.patients) setHistory(data.patients);
    } catch (err) { setLogs(prev => [...prev, "> !! LINK_FAILED"]); }
  }, []);

  useEffect(() => { if (department) fetchHistory(); }, [department, result, fetchHistory]);

  const processAI = async () => {
    if (!file || !patientName) return;
    setLoading(true);
    const formData = new FormData();
    formData.append('file', file);
    formData.append('department', department);
    formData.append('patient_name', patientName);
    try {
      const resp = await fetch('http://localhost:8000/process-scan', { method: 'POST', body: formData });
      const data = await resp.json();
      setResult(data);
      setActiveTab("REPORT"); // Switch to details
      setLogs(prev => [...prev, "> REVELIO_COMPLETE", "> DATA_MAPPED_TO_3D"]);
    } catch (e) { setLogs(prev => [...prev, "> !! SPELL_INTERRUPTED"]); }
    finally { setLoading(false); }
  };

  const obliterateRecords = async () => {
    if (window.confirm("OBLIVIATE ALL RECORDS?")) {
      await fetch('http://localhost:8000/clear-history', { method: 'DELETE' });
      setHistory([]);
      setResult(null);
      setLogs(prev => [...prev, "> !! RECORDS_ERASED"]); //
    }
  };

  if (!department) return (
    <div className="portal-master-container">
      <h1 className="main-wizard-title">SORCERY & CYBERSUITS</h1>
      <div className="portal-selection-grid">
        {['brain', 'heart', 'lungs'].map(id => (
          <div key={id} className="portal-magic-card" onClick={() => setDepartment(id)}>
            <h2 className="card-label">{id.toUpperCase()}</h2>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="sanctum-app-wrapper">
      <header className="sanctum-header-hud">
        <button className="back-portal-button" onClick={() => setDepartment(null)}>← PORTAL</button>
        <div className="chamber-identity-text">{department.toUpperCase()}_UNIT</div>
        <input className="magic-input-field" placeholder="SUBJECT..." value={patientName} onChange={e => setPatientName(e.target.value)} />
      </header>

      <div className="sanctum-main-layout">
        <aside className="sanctum-panel-box side-column">
          <div className="mystic-header-label">2D_VIEWPORT</div>
          <div className="mirror-viewport-circle">
            {preview ? <img src={preview} alt="Scan" className="scan-img-relic" /> : <div className="waiting-text">EMPTY</div>}
          </div>
          <input type="file" id="up" hidden onChange={e => {
            setFile(e.target.files[0]);
            setPreview(URL.createObjectURL(e.target.files[0]));
          }} />
          <label htmlFor="up" className="mystic-gold-button">LOAD_RELIQUARY</label>
          <button className="mystic-gold-button" onClick={processAI}>{loading ? "INVOCATING..." : "START_DIAGNOSTIC"}</button>
        </aside>

        <main className="sanctum-panel-box main-column">
          <div className="mystic-header-label">ETHEREAL_RECONSTRUCTION</div>
          <div className="three-dimension-viewport">
            {/* The upgraded tactical 3D view */}
            <MedicalMesh active={!!result} result={result} />
          </div>
        </main>

        <aside className="sanctum-panel-box side-column">
          <div className="tab-header">
            <button className={activeTab === "HISTORY" ? "active" : ""} onClick={() => setActiveTab("HISTORY")}>HISTORY</button>
            <button className={activeTab === "REPORT" ? "active" : ""} onClick={() => setActiveTab("REPORT")}>REPORT</button>
          </div>

          <div className="tab-content" style={{ flex: 1 }}>
            {activeTab === "HISTORY" ? (
              <div className="history-scrollable-list">
                {history.map((h, i) => <div key={i} className="history-relic-item">{h.patient}</div>)}
              </div>
            ) : (
              <div className="report-details-panel">
                {result ? (
                  <div className="report-grid">
                    <div>PATHOLOGY: {result.prediction}</div>
                    <div>CONFIDENCE: {result.confidence}%</div>
                    <div>VOLUME: {result.volume}</div>
                  </div>
                ) : <div className="no-archive-text">WAITING_FOR_DATA...</div>}
              </div>
            )}
          </div>

          <div className="mystic-header-label mt-10">RUNE_STREAM</div>
          <div className="terminal-log-output">{logs.map((l, i) => <div key={i}>{l}</div>)}</div>
          
          <button className="obliterate-records-btn" onClick={obliterateRecords}>WIPE_RECORDS</button>
        </aside>
      </div>
    </div>
  );
}

export default App;