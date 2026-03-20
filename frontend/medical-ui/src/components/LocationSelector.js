import React from 'react';

function LocationSelector({
  country,
  stateRegion,
  district,
  city,
  locality,
  residenceSummary,
  countryOptions,
  stateOptions,
  districtOptions,
  cityOptions,
  onCountryChange,
  onStateChange,
  onDistrictChange,
  onCityChange,
  onLocalityChange,
}) {
  return (
    <>
      <div className="meta-field">
        <label>Country</label>
        <select className="magic-input-field" value={country} onChange={onCountryChange}>
          <option value="">Select Country</option>
          {countryOptions.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      </div>

      <div className="meta-field">
        <label>State / Province</label>
        <select className="magic-input-field" value={stateRegion} onChange={onStateChange} disabled={!country}>
          <option value="">Select State / Province</option>
          {stateOptions.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      </div>

      <div className="meta-field">
        <label>District / County</label>
        <select className="magic-input-field" value={district} onChange={onDistrictChange} disabled={!stateRegion}>
          <option value="">Select District / County</option>
          {districtOptions.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      </div>

      <div className="meta-field">
        <label>City</label>
        <select className="magic-input-field" value={city} onChange={onCityChange} disabled={!district}>
          <option value="">Select City</option>
          {cityOptions.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      </div>

      <div className="meta-field">
        <label>Locality</label>
        <input
          className="magic-input-field"
          placeholder="e.g. Sector 5"
          value={locality}
          onChange={onLocalityChange}
        />
      </div>

      <div className="meta-field">
        <label>Residence Summary</label>
        <input
          className="magic-input-field"
          value={residenceSummary}
          readOnly
          placeholder="Your selected location will appear here"
        />
      </div>
    </>
  );
}

export default LocationSelector;
