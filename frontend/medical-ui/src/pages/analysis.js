import React from 'react';

export default function Analysis() {
  return (
    <div className="grid-3">
      {/* LEFT: Stats */}
      <div className="glass-panel">
        <h3 className="panel-title">CLINICAL_TELEMETRY</h3>
        <div style={{ marginBottom: '20px' }}>
          <div style={{ fontSize: '0.8rem', color: '#888' }}>MODEL_CONFIDENCE</div>
          <div style={{ fontSize: '2.5rem', color: '#00f2fe', textShadow: '0 0 10px #00f2fe' }}>99.83%</div>
        </div>
        <div>
          <div style={{ fontSize: '0.8rem', color: '#888' }}>DICE_SCORE</div>
          <div style={{ fontSize: '1.5rem' }}>0.941</div>
        </div>
      </div>

      {/* CENTER: 3D Hologram Area */}
      <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column' }}>
        <h3 className="panel-title">NEURAL_RECONSTRUCTION // LIVE</h3>
        <div style={{ flexGrow: 1, border: '1px solid rgba(0,242,254,0.2)', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {/* REPLACE THIS DIV WITH YOUR <MedicalCanvas /> LATER */}
          <div style={{ color: '#00f2fe', opacity: 0.5 }}>[ 3D_WIREFRAME_RENDER_AREA ]</div>
        </div>
      </div>

      {/* RIGHT: Controls */}
      <div className="glass-panel">
        <h3 className="panel-title">SYSTEM_CONTROLS</h3>
        <button className="nav-btn" style={{ width: '100%', justifyContent: 'center', marginBottom: '10px' }}>UPLOAD_DICOM</button>
        <button className="nav-btn" style={{ width: '100%', justifyContent: 'center' }}>INITIALIZE_AI</button>
      </div>
    </div>
  );
}