/**
 * A Nominatim (OpenStreetMap) válaszának magyar címkékre fordítása.
 *
 * Külön modul, mert ez az egyetlen rész, ami idegen adatszerkezetet értelmez —
 * a scraperekhez hasonlóan valódi válaszokon teszteljük.
 */

import type { GeocodeHit } from './ui/geocode';

export interface NominatimAddress {
  house_number?: string;
  road?: string;
  pedestrian?: string;
  footway?: string;
  neighbourhood?: string;
  suburb?: string;
  /** Budapesten ide kerül a "V. kerület". */
  borough?: string;
  city_district?: string;
  city?: string;
  town?: string;
  village?: string;
  postcode?: string;
}

export interface NominatimPlace {
  place_id?: number | string;
  lat?: string;
  lon?: string;
  name?: string;
  display_name?: string;
  address?: NominatimAddress;
}

/**
 * Egy találat két sorra bontva: mi az, és hol van.
 *
 * A `display_name` túl hosszú egy listaelemhez ("12, Váci utca, Pest,
 * Belváros, V. kerület, Budapest, 1052, Magyarország") — abból a listában
 * semmi sem olvasható ki egy pillantásra.
 */
export function toHit(place: NominatimPlace): GeocodeHit | null {
  const lat = Number(place.lat);
  const lon = Number(place.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  const address = place.address ?? {};
  const street = address.road ?? address.pedestrian ?? address.footway;

  // Magyarul a házszám a közterület neve után áll, ponttal.
  const streetLine = street
    ? address.house_number
      ? `${street} ${address.house_number}.`
      : street
    : undefined;

  // A Nominatim üres `name`-et ad az egyszerű épületekre — azt nem írjuk ki.
  const name = place.name?.trim() || undefined;
  const primary =
    streetLine && name && name !== street
      ? `${name}, ${streetLine}`
      : (streetLine ?? name ?? place.display_name?.split(',')[0]?.trim() ?? 'Ismeretlen hely');

  // A kerület a legbeszédesebb pontosítás Budapesten — a `borough` viszi,
  // a `suburb` csak városrésznevet ad ("Pest").
  const area =
    address.city_district ?? address.borough ?? address.suburb ?? address.neighbourhood;
  const settlement = address.city ?? address.town ?? address.village;
  const detail = [area, settlement].filter((part) => part && part !== primary).join(', ');

  return {
    id: String(place.place_id ?? `${lat},${lon}`),
    label: primary,
    detail: detail || 'Budapest',
    lat,
    lon,
  };
}

/**
 * A teljes válasz feldolgozása; az értelmezhetetlen elemeket kihagyjuk.
 *
 * Az azonos feliratú találatokat összevonjuk: ha a házszám nem talál, a
 * Nominatim ugyanannak az utcának több szakaszát is visszaadja, és a listában
 * négy egyforma „Hungária körút" sor jelenne meg — a felhasználó nem tudna
 * választani köztük. Az elsőt tartjuk meg, az a legrelevánsabb.
 */
export function toHits(payload: unknown): GeocodeHit[] {
  if (!Array.isArray(payload)) return [];

  const seen = new Set<string>();
  const hits: GeocodeHit[] = [];

  for (const place of payload) {
    const hit = toHit(place as NominatimPlace);
    if (!hit) continue;
    const key = `${hit.label}|${hit.detail}`.toLocaleLowerCase('hu-HU');
    if (seen.has(key)) continue;
    seen.add(key);
    hits.push(hit);
  }

  return hits;
}
