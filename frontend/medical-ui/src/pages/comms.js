import React from 'react';

export default function Comms() {
  return (
    <div className="grid-3" style={{ gridTemplateColumns: '1fr 2fr' }}>
      {/* Contacts list */}
      <div className="glass-panel">
        <h3 className="panel-title">ACTIVE_NODES</h3>
        <div className="nav-btn">Dr. Sarah (Oncology)</div>
        <div className="nav-btn">Node_Alpha (Radiology)</div>
        <div className="nav-btn">Patient_IE001 (Portal)</div>
      </div>

      {/* Chat Window */}
      <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column' }}>
        <h3 className="panel-title">ENCRYPTED_CHANNEL</h3>
        <div style={{ flexGrow: 1, border: '1px solid rgba(255,255,255,0.05)', padding: '10px', marginBottom: '10px' }}>
          <div style={{ color: '#888', fontSize: '0.8rem', marginBottom: '5px' }}>[11:42] Dr. Sarah:</div>
          <div style={{ marginBottom: '15px' }}>Please review the segmentation for IE-001. The AI flagged an anomaly in the left lobe.</div>
          
          <div style={{ color: '#00f2fe', fontSize: '0.8rem', marginBottom: '5px' }}>[11:45] You:</div>
          <div>Loading the 3D mesh now. Running secondary validation.</div>
        </div>
        <input 
          type="text" 
          placeholder="ENTER_MESSAGE..." 
          style={{ width: '100%', padding: '10px', background: 'rgba(0,0,0,0.5)', border: '1px solid #00f2fe', color: '#fff', outline: 'none' }}
        />
      </div>
    </div>
  );
}