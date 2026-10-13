/**
 * Földrajzi segédfüggvények — tiszta függvények, I/O nélkül.
 *
 * A távolság mindig légvonalbeli (nagykör) távolság: nem útvonaltervezés.
 * A felhasználónak ezt a UI úgy jelzi, hogy „légvonalban”.
 */

/** WGS84 koordináta. */
export interface LatLon {
  lat: number;
  lon: number;
}

/** A Föld közepes sugara km-ben (IUGG átlagos sugár). */
const EARTH_RADIUS_KM = 6371.0088;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * Nagykör (haversine) távolság két pont között, km-ben.
 * Érvénytelen (NaN / nem véges) bemenetre NaN-t ad vissza — a hívó dönt,
 * hogy ilyenkor `null` távolságot mutat.
 */
export function haversineKm(a: LatLon, b: LatLon): number {
  if (
    !Number.isFinite(a?.lat) ||
    !Number.isFinite(a?.lon) ||
    !Number.isFinite(b?.lat) ||
    !Number.isFinite(b?.lon)
  ) {
    return Number.NaN;
  }

  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);

  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);

  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon;
  // A min(1, …) a lebegőpontos hiba miatt kell: h egy hajszállal 1 fölé kerülhet.
  const c = 2 * Math.asin(Math.min(1, Math.sqrt(h)));

  return EARTH_RADIUS_KM * c;
}

/**
 * Magyar távolságformátum.
 *
 * - 1 km alatt méterben, 10 m-re kerekítve: `"650 m"`
 * - 1 km fölött tizedesvesszővel, egy tizedesjeggyel: `"2,3 km"`
 *
 * A tizedeselválasztó magyarul vessző, nem pont.
 */
export function formatDistanceHu(km: number): string {
  if (!Number.isFinite(km)) return 'ismeretlen távolság';

  const safeKm = Math.max(0, km);

  if (safeKm < 1) {
    // 10 méterre kerekítünk: a légvonalbeli becslés úgysem pontosabb ennél.
    const meters = Math.round((safeKm * 1000) / 10) * 10;
    // A felfelé kerekítés átvihet 1000 m-re — ilyenkor már km-ben mondjuk.
    if (meters >= 1000) return '1,0 km';
    return `${meters} m`;
  }

  return `${safeKm.toFixed(1).replace('.', ',')} km`;
}
