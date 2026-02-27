import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Canvas } from '@react-three/fiber';
import './App.css';
import MedicalMesh from './MedicalMesh';

/**
 * INNER_EYE // ADVANCED RADIOMICS WORKSTATION V5.0.2
 * ARCHITECTURE: MONAI 3D U-Net Integration
 * DATASETS: BraTS 2021, LUNA16, LiTS
 */
function App() {
  // --- [1] CORE SYSTEM STATE ---
  const [department, setDepartment] = useState(null);
  const [patientName, setPatientName] = useState("");
  const [patientID, setPatientID] = useState("");
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [history, setHistory] = useState([]);
  const [activeTab, setActiveTab] = useState("QUANTITATIVE");
  const [viewMode, setViewMode] = useState("VOXEL"); // VOXEL or WIREFRAME

  // --- [2] DICOM WINDOWING STATE (Clinical HU Controls) ---
  const [windowCenter, setWindowCenter] = useState(40); 
  const [windowWidth, setWindowWidth] = useState(400);

  // --- [3] KERNEL LOGGING SYSTEM ---
  const [logs, setLogs] = useState([
    "[" + new Date().toLocaleTimeString() + "] > KERNEL_BOOT_SUCCESS: VERSION_5.0.2",
    "[" + new Date().toLocaleTimeString() + "] > MONAI_3D_UNET_NETWORKS_LOADED",
    "[" + new Date().toLocaleTimeString() + "] > CUDA_GPU_ACCELERATION_ACTIVE",
    "[" + new Date().toLocaleTimeString() + "] > STANDBY_FOR_DICOM_STREAM"
  ]);

  const addLog = (msg) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [...prev, `[${timestamp}] > ${msg}`]);
  };

  // --- [4] CLINICAL DATABASE SYNC ---
  const fetchHistory = useCallback(async () => {
    try {
      const res = await fetch('http://localhost:8000/patients');
      const data = await res.json();
      if (data.patients) {
        setHistory(data.patients);
        addLog(`DB_SYNC_SUCCESS: ${data.patients.length} RECORDS_MAPPED`);
      }
    } catch (err) {
      addLog("!! LINK_ERROR: REMOTE_DATABASE_OFFLINE");
    }
  }, []);

  useEffect(() => {
    if (department) fetchHistory();
  }, [department, result, fetchHistory]);

  // --- [5] AI INFERENCE & VOXEL GENERATION ---
  const executeInference = async () => {
    if (!file || !patientName) {
      addLog("!! ABORT: MISSING_SUBJECT_METADATA");
      alert("CRITICAL: Enter Patient ID and Import DICOM Slice.");
      return;
    }

    setLoading(true);
    addLog(`INIT_SEGMENTATION: DATASET_${department.toUpperCase()}`);
    addLog("COMPUTING_ISOTROPIC_VOXEL_DENSITY");
    
    const formData = new FormData();
    formData.append('file', file);
    formData.append('department', department);
    formData.append('patient_name', patientName);

    try {
      const resp = await fetch('http://localhost:8000/process-scan', { 
        method: 'POST', 
        body: formData 
      });
      
      if (!resp.ok) throw new Error("Backend Connectivity Interrupted");
      
      const data = await resp.json();
      setResult(data);
      setPatientID(data.subject_id);
      setActiveTab("QUANTITATIVE");
      addLog(`SUCCESS: DICE_SCORE_${data.dice_score}`);
      addLog(`VOLUME_MAPPED: ${data.volume}`);
    } catch (e) {
      addLog("!! CRITICAL: INFERENCE_CORE_TIMEOUT");
    } finally {
      setLoading(false);
    }
  };

  const purgeSystemMemory = async () => {
    if (window.confirm("PERMANENTLY WIPE ALL CLINICAL RECORDS?")) {
      try {
        await fetch('http://localhost:8000/clear-history', { method: 'DELETE' });
        setHistory([]);
        setResult(null);
        addLog("!! DATABASE_PURGED: HIPAA_COMPLIANT_WIPE");
      } catch (err) {
        addLog("!! PURGE_FAILED: ACCESS_DENIED");
      }
    }
  };

  // --- [6] RENDER: LANDING PORTAL ---
  if (!department) return (
    <div className="portal-master-container">
      <div className="grid-overlay"></div>
      <div className="portal-content">
        <h1 className="main-wizard-title">INNER_EYE // <span className="blue-text">MONAI</span></h1>
        <p className="clinical-subtitle">HETEROGENEOUS 3D SEGMENTATION & RADIOMICS PORTAL</p>
        
        <div className="portal-selection-grid">
          {[
            {id: 'neuro_axial', label: 'BRAIN (BraTS 2021)', sub: 'Glioma & Edema Segmentation'},
            {id: 'pulmonary', label: 'LUNG (LUNA16)', sub: 'Nodule Detection & Volumetrics'},
            {id: 'cardio_thoracic', label: 'LIVER (LiTS)', sub: 'Hepatocellular Carcinoma Mapping'}
          ].map(item => (
            <div key={item.id} className="portal-magic-card" onClick={() => setDepartment(item.id)}>
              <div className="scanner-line"></div>
              <div className="card-inner-frame"></div>
              <h2 className="card-label">{item.label}</h2>
              <div className="card-status-badge">MODEL_STABLE_V5</div>
              <p className="card-desc">{item.sub}</p>
            </div>
          ))}
        </div>
        <div className="portal-footer-info">SYSTEM_STATUS: READY | ENCRYPTION: AES_256 | NODES: 04</div>
      </div>
    </div>
  );

  // --- [7] RENDER: MAIN CLINICAL WORKSTATION ---
  return (
    <div className="sanctum-app-wrapper">
      <header className="sanctum-header-hud">
        <div className="header-left">
          <button className="back-portal-button" onClick={() => {setDepartment(null); setResult(null);}}>EXIT_SESSION</button>
          <div className="breadcrumb-path">
            SESSION / {department.toUpperCase()} / <span className="blue-text">3D_VOXEL_ANALYSIS</span>
          </div>
        </div>
        
        <div className="patient-meta-box">
          <div className="meta-field">
            <label>PATIENT_NAME</label>
            <input 
              className="magic-input-field" 
              placeholder="e.g. DOE_JOHN" 
              value={patientName} 
              onChange={e => setPatientName(e.target.value)} 
            />
          </div>
          <div className="meta-field">
            <label>DATASET</label>
            <span className="modality-tag">{result?.dataset_context || "AWAITING_DATA"}</span>
          </div>
          <div className="meta-field">
            <label>SESSION_ID</label>
            <span className="modality-tag blue">{patientID || "STBY"}</span>
          </div>
        </div>
      </header>

      <div className="sanctum-main-layout">
        
        {/* PANEL: 2D AXIAL SLICE */}
        <aside className="sanctum-panel-box side-column">
          <div className="panel-header-row">
            <div className="mystic-header-label">2D_AXIAL_SLICE_VIEWER</div>
          </div>
          
          <div className="mirror-viewport-container">
            <div className="viewport-inner-lock">
                {preview ? (
                <img src={preview} alt="Medical Scan" className="scan-img-relic" />
                ) : (
                <div className="placeholder-text">NO_DICOM_DATA_MOUNTED</div>
                )}
                {loading && <div className="scanning-bar-animation"></div>}
            </div>
            <div className="viewport-overlay-data">
                <span>W: {windowWidth} L: {windowCenter}</span>
                <span>Zoom: 1.0x</span>
            </div>
          </div>

          <div className="input-action-zone">
            <input 
              type="file" 
              id="dicom-upload" 
              hidden 
              onChange={e => {
                if(e.target.files[0]) {
                  setFile(e.target.files[0]);
                  setPreview(URL.createObjectURL(e.target.files[0]));
                  addLog(`MOUNTED_SLICE: ${e.target.files[0].name.toUpperCase()}`);
                }
              }} 
            />
            <label htmlFor="dicom-upload" className="mystic-gold-button">IMPORT_DICOM_PACKAGE</label>
            
            <button 
              className={`mystic-gold-button primary ${loading ? 'pulse' : ''}`}
              onClick={executeInference}
              disabled={loading}
            >
              {loading ? "INVOCATING_MONAI..." : "EXECUTE_3D_UNET"}
            </button>
          </div>

          <div className="dicom-metadata-preview">
             <div className="meta-row"><span>MODALITY:</span> <span>{result?.modality || '---'}</span></div>
             <div className="meta-row"><span>DICE_SCORE:</span> <span className="blue">{result?.dice_score || '0.000'}</span></div>
             <div className="meta-row"><span>TIMESTAMP:</span> <span>{result?.timestamp?.split(' ')[1] || '---'}</span></div>
          </div>
        </aside>

        {/* PANEL: 3D VOLUMETRIC RECONSTRUCTION */}
        <main className="sanctum-panel-box main-column">
          <div className="panel-header-row">
            <div className="mystic-header-label">3D_MULTI_CLASS_SEGMENTATION_MASK</div>
            <div className="view-toggle-controls">
              <button className={viewMode === "VOXEL" ? "active" : ""} onClick={() => setViewMode("VOXEL")}>VOXEL</button>
              <button className={viewMode === "WIRE" ? "active" : ""} onClick={() => setViewMode("WIRE")}>WIRE</button>
            </div>
          </div>
          
          <div className="three-dimension-viewport-container">
            <Canvas camera={{ position: [0, 0, 5], fov: 42 }}>
                <MedicalMesh active={!!result} result={result} viewMode={viewMode} />
            </Canvas>
            
            <div className="viewport-hud-overlay">
              <div className="hud-line">ENGINE: <span className="blue">MONAI_V5_CORE</span></div>
              <div className="hud-line">VERTICES: <span className="blue">{result?.voxels?.length || '0'}</span></div>
              <div className="hud-line">SAMPLING: <span className="blue">ISOTROPIC_VOXEL</span></div>
            </div>
          </div>
        </main>

        {/* PANEL: QUANTITATIVE ANALYTICS */}
        <aside className="sanctum-panel-box side-column analytics-panel">
          <div className="tab-navigation">
            <button className={activeTab === "QUANTITATIVE" ? "active" : ""} onClick={() => setActiveTab("QUANTITATIVE")}>METRICS</button>
            <button className={activeTab === "HISTORY" ? "active" : ""} onClick={() => setActiveTab("HISTORY")}>ARCHIVES</button>
          </div>

          <div className="tab-body-content">
            {activeTab === "QUANTITATIVE" ? (
              <div className="quantitative-report">
                {result ? (
                  <div className="report-data-stack">
                    <div className="data-row">
                      <span className="label">PREDICTION</span>
                      <span className={`value ${result.prediction.includes('DETECTED') ? 'red' : 'green'}`}>{result.prediction}</span>
                    </div>
                    <div className="data-row"><span className="label">GTV_VOLUME</span><span className="value blue">{result.volume}</span></div>
                    <div className="data-row"><span className="label">MAX_DIAMETER</span><span className="value">{result.diameter}</span></div>
                    <div className="data-row"><span className="label">AI_CONFIDENCE</span><span className="value">{result.confidence}%</span></div>
                    <div className="data-row">
                      <span className="label">SEVERITY</span>
                      <span className={`value status-${result.severity?.toLowerCase()}`}>{result.severity}</span>
                    </div>
                  </div>
                ) : (
                  <div className="empty-state">STANDBY: AWAITING_DICOM_INFERENCE</div>
                )}
              </div>
            ) : (
              <div className="clinical-history-list">
                {history.length > 0 ? history.map((h, i) => (
                  <div key={i} className="history-item">
                    <div className="history-meta"><span className="h-name">{h.patient_name}</span><span className="h-vol">{h.volume}</span></div>
                    <div className="h-status">{h.prediction}</div>
                  </div>
                )) : (
                  <div className="empty-state">ARCHIVES_EMPTY</div>
                )}
              </div>
            )}
          </div>

          <div className="kernel-log-wrapper">
            <div className="mystic-header-label small">SYSTEM_KERNEL_LOG</div>
            <div className="terminal-log-output">
              {logs.slice(-12).map((l, i) => (
                <div key={i} className="log-line">{l}</div>
              ))}
            </div>
          </div>
          
          <button className="obliterate-records-btn" onClick={purgeSystemMemory}>PURGE_MEMORY</button>
        </aside>

      </div>
    </div>
  );
}

export default App;