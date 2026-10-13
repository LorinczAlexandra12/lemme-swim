/**
 * Magyar címkék a típusokban szereplő gépi kulcsokhoz.
 * A UI sehol nem mutat angol enum-értéket a felhasználónak.
 */

import type { BlockKind, Confidence, Weekday } from '@/lib/types';

export const BLOCK_KIND_LABEL: Record<BlockKind, string> = {
  club: 'Egyesületi edzés',
  school: 'Iskolai úszásoktatás',
  course: 'Úszótanfolyam',
  event: 'Verseny vagy rendezvény',
  maintenance: 'Karbantartás',
  closed: 'Zárva',
};

export const WEEKDAY_LABEL: Record<Weekday, string> = {
  1: 'hétfő',
  2: 'kedd',
  3: 'szerda',
  4: 'csütörtök',
  5: 'péntek',
  6: 'szombat',
  7: 'vasárnap',
};

export const WEEKDAY_SHORT: Record<Weekday, string> = {
  1: 'H',
  2: 'K',
  3: 'Sze',
  4: 'Cs',
  5: 'P',
  6: 'Szo',
  7: 'V',
};

/**
 * Mit mondunk a felhasználónak az adat frissességéről.
 * Ez a termék lelke: sosem sugallunk nagyobb biztonságot, mint amink van.
 */
export const CONFIDENCE_TONE: Record<
  Confidence,
  { label: string; help: string; tone: 'live' | 'verified' | 'stale' | 'unknown' }
> = {
  live: {
    label: 'Friss adat',
    help: 'Az uszoda saját beosztásából ma lekért sávfoglalás.',
    tone: 'live',
  },
  verified: {
    label: 'Ellenőrzött',
    help: 'Kézzel rögzített beosztás, emberi szemmel ellenőrizve.',
    tone: 'verified',
  },
  stale: {
    label: 'Régi adat',
    help: 'Régóta nem frissült beosztás — indulás előtt érdemes ellenőrizni.',
    tone: 'stale',
  },
  unknown: {
    label: 'Nincs sávadat',
    help: 'Erről a medencéről csak nyitvatartásunk van, sávbeosztásunk nincs.',
    tone: 'unknown',
  },
};

/** Az uszoda-rekord egészére vonatkozó megbízhatóság. */
export const POOL_CONFIDENCE_LABEL: Record<'high' | 'medium' | 'low', string> = {
  high: 'Megbízható adatlap',
  medium: 'Részben ellenőrzött adatlap',
  low: 'Hiányos adatlap',
};

export const SOURCE_FORMAT_LABEL: Record<string, string> = {
  'html-table': 'weboldali táblázat',
  pdf: 'PDF beosztás',
  image: 'képként közzétett beosztás',
  'facebook-only': 'csak Facebook-bejegyzés',
  'none-found': 'nem találtunk forrást',
};
