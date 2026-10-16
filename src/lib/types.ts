/**
 * Uszoda Tracker — közös adatmodell.
 *
 * Ez a fájl a projekt szerződése: a scraperek ilyen alakú adatot állítanak elő,
 * a kereső/elérhetőség-motor ilyet fogyaszt, és a UI ilyet jelenít meg.
 * Mindent, ami a felhasználónak megjelenik, magyarul tárolunk.
 */

/** ISO hétköznap: 1 = hétfő ... 7 = vasárnap. */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** "HH:MM" 24 órás formátum, helyi (Europe/Budapest) idő. */
export type TimeOfDay = string;

/** "YYYY-MM-DD" naptári dátum, helyi idő szerint. */
export type IsoDate = string;

// ---------------------------------------------------------------------------
// Uszodák és medencék
// ---------------------------------------------------------------------------

export interface Basin {
  /** Uszodán belül egyedi azonosító, pl. "50m-fedett". */
  id: string;
  /** Magyar megjelenítendő név, pl. "50 m-es fedett medence". */
  name: string;
  /** Medencehossz méterben. */
  lengthM: number;
  /** Felfestett úszósávok száma. `null`, ha nem sikerült hitelesen megállapítani. */
  lanes: number | null;
  /** Fedett (true) vagy szabadtéri (false). */
  indoor: boolean;
  /** Szabadtéri medencéknél a szezon, pl. "május közepétől szeptemberig". */
  seasonNote?: string;
  /** Vízhőmérséklet °C-ban, ha publikálják. */
  waterTempC?: number;
}

export interface OpeningHours {
  weekday: Weekday;
  opens: TimeOfDay;
  closes: TimeOfDay;
  /** Ha csak bizonyos időszakban érvényes, pl. "nyári nyitvatartás". */
  seasonNote?: string;
}

/**
 * Honnan származik az uszoda sávbeosztása, és mennyire bízhatunk benne.
 * A UI ezt mindig megmutatja, hogy a felhasználó tudja, mennyire friss az adat.
 */
export interface ScheduleSource {
  /**
   * - `scraper`: automatikusan lekért, gépi olvasású forrás
   * - `curated`: kézzel rögzített, rendszeresen ellenőrzött adat
   * - `none`: nincs sávbeosztásunk, csak nyitvatartás
   */
  type: 'scraper' | 'curated' | 'none';
  /** A scraper adapter azonosítója, ha `type === 'scraper'`. */
  adapter?: string;
  /** A forrásoldal vagy PDF pontos URL-je — a UI hivatkozik rá. */
  url?: string;
  /** A publikált forrás formátuma. */
  format?: 'html-table' | 'pdf' | 'image' | 'facebook-only' | 'none-found';
  /** Mikor ellenőriztük utoljára emberi szemmel ("YYYY-MM-DD"). */
  lastVerified?: IsoDate;
  /** Mikor futott le sikeresen a scraper (ISO 8601 időbélyeg). */
  lastScrapedAt?: string;
  note?: string;
}

export interface Pool {
  /** Globálisan egyedi slug, pl. "csaszar-komjadi". */
  id: string;
  name: string;
  shortName?: string;
  /** Kerület római számmal és ponttal, pl. "XIII." */
  district?: string;
  address: string;
  /** WGS84. `null`, ha nem sikerült hitelesíteni — ilyenkor távolságot sem számolunk. */
  lat: number | null;
  lon: number | null;
  website?: string;
  phone?: string;
  basins: Basin[];
  openingHours: OpeningHours[];
  scheduleSource: ScheduleSource;
  /** A kutatás során ténylegesen lekért forrás-URL-ek. */
  sources?: string[];
  /** Mennyire megbízható a rekord egésze. */
  confidence?: 'high' | 'medium' | 'low';
}

// ---------------------------------------------------------------------------
// Sávfoglalások
// ---------------------------------------------------------------------------

export type BlockKind =
  | 'club' // egyesületi edzés
  | 'school' // iskolai úszásoktatás
  | 'course' // úszótanfolyam
  | 'event' // verseny, rendezvény
  | 'maintenance' // karbantartás, technikai szünet
  | 'closed'; // a medence zárva

/**
 * Egy időszak, amely elvesz `lanesOccupied` sávot egy medencéből.
 * Vagy heti ismétlődő (`weekday`), vagy egyszeri (`date`) — pontosan az egyik.
 */
export interface LaneBlock {
  poolId: string;
  basinId: string;
  weekday?: Weekday;
  date?: IsoDate;
  start: TimeOfDay;
  end: TimeOfDay;
  /** Hány sávot foglal el. `closed`/`maintenance` esetén a medence teljes sávszáma. */
  lanesOccupied: number;
  kind: BlockKind;
  /** Magyar leírás, pl. "BVSC utánpótlás edzés". */
  reason: string;
}

/** Egy scraper futás eredménye egy uszodára. */
export interface ScrapeResult {
  poolId: string;
  adapter: string;
  scrapedAt: string;
  ok: boolean;
  blocks: LaneBlock[];
  /** Emberi olvasású hibaüzenet, ha `ok === false`. */
  error?: string;
  /** Amit a scraper látott, de nem tudott értelmezni — hibakereséshez. */
  warnings?: string[];
}

// ---------------------------------------------------------------------------
// Lekérdezés és találatok
// ---------------------------------------------------------------------------

export interface SearchQuery {
  /** A felhasználó pozíciója. */
  lat: number;
  lon: number;
  /** A kért idősáv napja. */
  date: IsoDate;
  start: TimeOfDay;
  end: TimeOfDay;
  /** Maximális távolság km-ben; ha nincs megadva, nincs szűrés. */
  maxDistanceKm?: number;
  /** Csak azok az uszodák, ahol legalább ennyi szabad sáv van. */
  minFreeLanes?: number;
  /** Csak fedett medencék. */
  indoorOnly?: boolean;
}

/**
 * Mennyire hihető egy adott szabad-sáv szám.
 * A UI ezt színnel/címkével jelzi — sosem állítunk biztosat bizonytalan adatból.
 */
export type Confidence =
  | 'live' // friss scraper-adat
  | 'verified' // kézzel ellenőrzött, a `lastVerified` dátum friss
  | 'stale' // van adatunk, de régi
  | 'unknown'; // nincs sávbeosztásunk, csak nyitvatartás

export interface BasinAvailability {
  basin: Basin;
  /** Összes felfestett sáv. `null`, ha ismeretlen. */
  totalLanes: number | null;
  /**
  * A kért idősáv nyitvatartásra eső részein szabadon maradó sávok száma.
   * A legrosszabb (legkevesebb szabad sávot adó) részintervallum értéke,
   * hogy ne ígérjünk olyan sávot, ami a közepén elfogy. `null`, ha ismeretlen.
   */
  freeLanes: number | null;
  /** A kért idősávot érintő foglalások. */
  blocks: LaneBlock[];
  /** Nyitva van-e a medence a kért idősáv teljes hosszában. */
  openThroughout: boolean;
  /**
   * Van-e egyáltalán nyitvatartási adatunk a kért napra.
   *
   * Elkülönítve az `openThroughout`-tól, mert a kettő nem ugyanaz: több uszoda
   * hiányosan publikálja a nyitvatartását (a Nyéki Imre például a péntekét
   * egyszerűen kihagyja). Ilyenkor a „zárva" magabiztosan téves állítás lenne —
   * a felület inkább bevallja, hogy nem tudjuk.
   */
  openingHoursKnown: boolean;
  openIntervals: { start: TimeOfDay; end: TimeOfDay }[];
  confidence: Confidence;
}

export interface PoolAvailability {
  pool: Pool;
  /** Légvonalbeli távolság km-ben. `null`, ha az uszodának nincs koordinátája. */
  distanceKm: number | null;
  basins: BasinAvailability[];
  /** A medencék szabad sávjainak összege. `null`, ha egyik sem ismert. */
  totalFreeLanes: number | null;
  /** A találat egészére vonatkozó megbízhatóság (a legrosszabb medencéé). */
  confidence: Confidence;
}
