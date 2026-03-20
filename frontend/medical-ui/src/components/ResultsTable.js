import React from 'react';

export default function ResultsTable({ tests }) {
  if (!Array.isArray(tests) || tests.length === 0) {
    return null;
  }

  return (
    <table className="results-table">
      <thead>
        <tr>
          <th>Test</th>
          <th>Value</th>
          <th>Range</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {tests.map((t, i) => (
          <tr key={i}>
            <td>{t.name}</td>
            <td>{t.value} {t.unit}</td>
            <td>{t.normal_range}</td>
            <td className={`results-status results-status-${String(t.status || '').toLowerCase()}`}>
              {t.status}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}