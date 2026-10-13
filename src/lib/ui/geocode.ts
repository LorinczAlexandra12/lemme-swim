/** A címkereső (`/api/geocode`) és a felület közös szerződése. */

export interface GeocodeHit {
  id: string;
  /** Az elsődleges sor, pl. "Váci utca 12." */
  label: string;
  /** A pontosító sor, pl. "V. kerület, Budapest". */
  detail: string;
  lat: number;
  lon: number;
}

/** Egy találat egysoros alakja, ahogy a keresési összefoglalóban megjelenik. */
export function fullAddress(hit: GeocodeHit): string {
  return hit.detail ? `${hit.label}, ${hit.detail}` : hit.label;
}
