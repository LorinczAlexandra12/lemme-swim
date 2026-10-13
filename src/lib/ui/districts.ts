/**
 * Budapest kerületei, közelítő középponttal.
 *
 * Ez a helymeghatározás tartaléka: ha a felhasználó nem osztja meg a helyzetét,
 * a kiválasztott kerület középpontjából számolunk távolságot. Nem pontos cím,
 * de működőképessé teszi az alkalmazást engedély nélkül is.
 */

export interface DistrictOption {
  /** Római számos kerületjelölés, ahogy a Pool.district mezőben is szerepel. */
  code: string;
  /** Teljes megjelenítendő név, pl. "XIII. kerület (Angyalföld)". */
  label: string;
  lat: number;
  lon: number;
}

export const BUDAPEST_DISTRICTS: DistrictOption[] = [
  { code: 'I.', label: 'I. kerület (Várkerület)', lat: 47.4969, lon: 19.0347 },
  { code: 'II.', label: 'II. kerület (Rózsadomb)', lat: 47.535, lon: 18.986 },
  { code: 'III.', label: 'III. kerület (Óbuda-Békásmegyer)', lat: 47.58, lon: 19.035 },
  { code: 'IV.', label: 'IV. kerület (Újpest)', lat: 47.565, lon: 19.09 },
  { code: 'V.', label: 'V. kerület (Belváros-Lipótváros)', lat: 47.5, lon: 19.052 },
  { code: 'VI.', label: 'VI. kerület (Terézváros)', lat: 47.509, lon: 19.068 },
  { code: 'VII.', label: 'VII. kerület (Erzsébetváros)', lat: 47.5, lon: 19.074 },
  { code: 'VIII.', label: 'VIII. kerület (Józsefváros)', lat: 47.49, lon: 19.078 },
  { code: 'IX.', label: 'IX. kerület (Ferencváros)', lat: 47.47, lon: 19.088 },
  { code: 'X.', label: 'X. kerület (Kőbánya)', lat: 47.478, lon: 19.15 },
  { code: 'XI.', label: 'XI. kerület (Újbuda)', lat: 47.462, lon: 19.025 },
  { code: 'XII.', label: 'XII. kerület (Hegyvidék)', lat: 47.498, lon: 18.99 },
  { code: 'XIII.', label: 'XIII. kerület (Angyalföld)', lat: 47.535, lon: 19.068 },
  { code: 'XIV.', label: 'XIV. kerület (Zugló)', lat: 47.52, lon: 19.11 },
  { code: 'XV.', label: 'XV. kerület (Rákospalota)', lat: 47.562, lon: 19.12 },
  { code: 'XVI.', label: 'XVI. kerület (Mátyásföld)', lat: 47.515, lon: 19.19 },
  { code: 'XVII.', label: 'XVII. kerület (Rákosmente)', lat: 47.48, lon: 19.25 },
  { code: 'XVIII.', label: 'XVIII. kerület (Pestszentlőrinc)', lat: 47.43, lon: 19.18 },
  { code: 'XIX.', label: 'XIX. kerület (Kispest)', lat: 47.45, lon: 19.14 },
  { code: 'XX.', label: 'XX. kerület (Pesterzsébet)', lat: 47.43, lon: 19.12 },
  { code: 'XXI.', label: 'XXI. kerület (Csepel)', lat: 47.42, lon: 19.07 },
  { code: 'XXII.', label: 'XXII. kerület (Budafok-Tétény)', lat: 47.42, lon: 18.99 },
  { code: 'XXIII.', label: 'XXIII. kerület (Soroksár)', lat: 47.395, lon: 19.12 },
];

export function findDistrict(code: string): DistrictOption | undefined {
  return BUDAPEST_DISTRICTS.find((d) => d.code === code);
}
