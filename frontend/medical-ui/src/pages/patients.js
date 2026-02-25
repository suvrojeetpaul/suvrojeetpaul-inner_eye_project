import React from 'react';

export default function Patients() {
  const dummyPatients = [
    { id: "IE-001", age: 45, scan: "Thoracic CT", status: "AI_ANALYZED" },
    { id: "IE-002", age: 62, scan: "Brain MRI", status: "PENDING_SCAN" },
    { id: "IE-003", age: 28, scan: "Abdominal CT", status: "REVIEW_REQUIRED" },
  ];

  return (
    <div className="glass-panel" style={{ height: '100%' }}>
      <h3 className="panel-title">GLOBAL_PATIENT_REGISTRY</h3>
      <table className="cyber-table">
        <thead>
          <tr>
            <th>PATIENT_ID</th>
            <th>AGE</th>
            <th>SCAN_TYPE</th>
            <th>AI_STATUS</th>
            <th>ACTION</th>
          </tr>
        </thead>
        <tbody>
          {dummyPatients.map(p => (
            <tr key={p.id}>
              <td>{p.id}</td>
              <td>{p.age}</td>
              <td>{p.scan}</td>
              <td><span className="status-badge">{p.status}</span></td>
              <td><button style={{background: 'transparent', color: '#00f2fe', border: 'none', cursor: 'pointer'}}>LOAD_DATA</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}