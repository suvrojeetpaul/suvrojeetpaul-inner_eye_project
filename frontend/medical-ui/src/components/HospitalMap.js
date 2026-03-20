import React, { memo, useMemo } from 'react';
import { MapContainer, Marker, Popup, TileLayer } from 'react-leaflet';
import L from 'leaflet';

const markerIcon = new L.Icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

function HospitalMap({ hospitals = [], emergencyMode = false }) {
  const mapData = useMemo(() => {
    const valid = hospitals.filter((row) => Number.isFinite(row.lat) && Number.isFinite(row.lon));
    if (valid.length === 0) {
      return {
        center: [22.5726, 88.3639],
        markers: [],
      };
    }

    const avgLat = valid.reduce((sum, row) => sum + Number(row.lat), 0) / valid.length;
    const avgLon = valid.reduce((sum, row) => sum + Number(row.lon), 0) / valid.length;
    return {
      center: [avgLat, avgLon],
      markers: valid,
    };
  }, [hospitals]);

  return (
    <div className={`hospital-map-wrap ${emergencyMode ? 'emergency' : ''}`}>
      <MapContainer center={mapData.center} zoom={4} scrollWheelZoom style={{ height: '300px', width: '100%' }}>
        <TileLayer
          attribution='&copy; OpenStreetMap contributors'
          url='https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
        />
        {mapData.markers.map((hospital, idx) => (
          <Marker key={`${hospital.hospital}-${idx}`} position={[hospital.lat, hospital.lon]} icon={markerIcon}>
            <Popup>
              <strong>{hospital.hospital}</strong><br />
              {hospital.city}, {hospital.country}<br />
              Beds: {hospital.available_beds} | ICU: {hospital.icu_beds}
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}

export default memo(HospitalMap);
