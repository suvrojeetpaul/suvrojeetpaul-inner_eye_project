import React, { useState } from "react";

export default function Upload({ setResult }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setError("");

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/analyzeReport", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || "Failed to analyze report");
      }

      setResult(data);
    } catch (err) {
      setError(err.message || "Upload failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <input type="file" accept=".pdf,.png,.jpg,.jpeg" onChange={handleUpload} />
      {loading && <p>Analyzing report...</p>}
      {error && <p>{error}</p>}
    </div>
  );
}
