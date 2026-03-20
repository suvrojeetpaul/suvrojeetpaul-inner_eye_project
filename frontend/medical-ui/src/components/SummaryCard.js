import React from 'react';

export default function SummaryCard({ summary, advice }) {
  if (!summary && !advice) {
    return null;
  }

  return (
    <div className="summary-card">
      <h3 className="summary-card-title">Summary</h3>
      <p className="summary-card-copy">{summary || 'No summary available.'}</p>

      <h3 className="summary-card-title">AI Advice</h3>
      <p className="summary-card-copy">{advice || 'No advice available.'}</p>

      <small className="summary-card-note">
        Warning: Not a medical diagnosis. Consult a doctor.
      </small>
    </div>
  );
}