// Great-circle helpers. Points are { lat, lon } in degrees, distances in nautical miles.
const R_NM = 3440.065;
export const NM_TO_M = 1852;
export const toRad = (d) => (d * Math.PI) / 180;
export const toDeg = (r) => (r * 180) / Math.PI;
export const norm360 = (d) => ((d % 360) + 360) % 360;

export function distanceNm(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_NM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function bearingDeg(a, b) {
  const p1 = toRad(a.lat), p2 = toRad(b.lat), dLon = toRad(b.lon - a.lon);
  const y = Math.sin(dLon) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dLon);
  return norm360(toDeg(Math.atan2(y, x)));
}

export function destination(p, brgDeg, distNm) {
  const d = distNm / R_NM, b = toRad(brgDeg), p1 = toRad(p.lat), l1 = toRad(p.lon);
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return { lat: toDeg(p2), lon: ((toDeg(l2) + 540) % 360) - 180 };
}

export const pad3 = (deg) => String(Math.round(norm360(deg)) % 360).padStart(3, '0');

function dm(value, pos, neg, width) {
  const hemi = value >= 0 ? pos : neg;
  const abs = Math.abs(value);
  let deg = Math.floor(abs);
  let min = (abs - deg) * 60;
  if (min >= 59.995) { deg += 1; min = 0; }
  return `${hemi}${String(deg).padStart(width, '0')}°${min.toFixed(2).padStart(5, '0')}'`;
}

// Degrees + decimal minutes, e.g. N38°12.34' W097°30.12'
export const fmtLatLon = (lat, lon) => `${dm(lat, 'N', 'S', 2)} ${dm(lon, 'E', 'W', 3)}`;

export const fmtAlt = (ft) =>
  ft == null ? '---' : ft >= 18000 ? `FL${String(Math.round(ft / 100)).padStart(3, '0')}` : `${Math.round(ft / 10) * 10} ft`;
