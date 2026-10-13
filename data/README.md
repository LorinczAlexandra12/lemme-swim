# `data/` — adatforrások és karbantartás

Ez a mappa az alkalmazás teljes adatkészletét tartalmazza. Két, élesen
elkülönülő adatfajta van benne:

| Fájl | Mi ez | Ki írja |
| --- | --- | --- |
| `pools.json` | uszodák, medencék, nyitvatartás | `npm run build:dataset` a `research/` fájlokból |
| `blocks.json` | **sávfoglaltság** (ki foglalja el a sávokat és mikor) | `npm run scrape` + kézi karbantartás |
| `schedule-sources.json` | uszodánként: HONNAN és MIKORRÓL van sávadatunk | `npm run scrape` (scraper) + kézi (`curated`) |
| `research/*.json` | a kutatás nyers jegyzetei uszodánként | kézi |
| `.cache/` | a scraperek letöltött nyers válaszai | `npm run scrape`, bármikor törölhető |

> A `pools.json` és a `research/` nem ennek a dokumentumnak a tárgya — itt a
> **sávbeosztás** eredetét írjuk le.

---

## 1. Mennyire gépi olvasású a budapesti sávbeosztás?

Röviden: **alig.** Végignéztük az összes uszodát, amelyről a `research/`
mappában adat van. Az eredmény:

* **Egyetlen** uszoda publikál valódi HTML **táblázatot** (BVSC-Zugló, a
  FacilityPilot foglalási rendszer beágyazott naptára).
* További négy uszoda publikál **gépileg feldolgozható**, de nem táblázatos
  beosztást: két PDF, amelyben a foglaltságot a cellák **kitöltőszíne** kódolja
  (Csepel, Újhegyi), egy PDF ugyanilyen színkóddal + dekódolható
  jelmagyarázattal (TVE), és egy sima szöveges HTML-felsorolás
  (Tüskecsarnok).
* Két uszoda a *legjobb minőségű* adatot publikálja, de **képként** (Kispest
  PNG, Dagály JPG) — ezeket kézzel visszük.
* A többinél (Császár-Komjádi, Duna Aréna, Hajós Alfréd, Ferencváros, Újlak,
  Újpest, Nyéki Imre, …) **nincs publikált sávbeosztás** semmilyen formában,
  vagy csak Facebook-képeken jelenik meg.
* **Nincs** sehol iCal/ICS-naptár, nyílt API vagy JSON-végpont, amely a
  sávbeosztást adná. (A WordPress `wp-json` médiakönyvtár csak a feltöltött
  kép/PDF fájlok listáját adja, magát a beosztást nem.)

Ezért van minden forráshoz **külön, kézzel írt adapter**: közös séma, szabvány
vagy API nem létezik ebben a témakörben.

---

## 2. `blocks.json` szerkezete

```jsonc
{
  "note": "…",
  "curatedPools": ["kispesti-uszoda", "dagaly-furdo-es-uszoda"],
  "blocks": [
    {
      "poolId": "kispesti-uszoda",        // MEG KELL EGYEZNIE a pools.json id-jével
      "basinId": "33m-uszomedence",       // a medence id-je ugyanabban az uszodában
      "date": "2026-09-21",               // PONTOSAN az egyik: date VAGY weekday
      "weekday": 1,                       // 1 = hétfő … 7 = vasárnap
      "start": "08:00",                   // "ÓÓ:PP", 24 órás
      "end": "09:00",                     // szigorúan nagyobb, mint a start
      "lanesOccupied": 1,                 // hány sáv FOGLALT (nem sávsorszám!)
      "kind": "club",                     // club | school | course | event | maintenance | closed
      "reason": "…"                       // magyar, a felhasználónak megjelenő indoklás
    }
  ]
}
```

Két szabály, amit könnyű elrontani:

1. **`lanesOccupied` DARABSZÁM, nem sávsorszám.** Ha a beosztásban az 5., 6. és
   7. sáv foglalt, akkor `lanesOccupied: 3`.
2. **Egy medencére egy időpontban az átfedő blokkok ÖSSZEADÓDNAK.** Ezért egy
   napon belül ugyanarra a medencére **soha ne adj meg átfedő blokkokat** —
   különben a szabad sávok száma hibásan a nulla felé megy. Minden adapternek
   van erre külön tesztje.

---

## 3. A scraperek futtatása

```bash
npm run scrape                       # minden adapter, gyorsítótárral
npm run scrape -- --dry-run          # semmit nem ír, csak mutatja az eredményt
npm run scrape -- --only=bvsc-facilitypilot
npm run scrape -- --no-cache         # a data/.cache megkerülése (friss letöltés)
```

A futás magyar nyelvű összegzést ír ki, és **nem nulla kilépési kóddal**
zárul, ha bármelyik adapter hibára futott. Ez szándékos: egy néma, üres
eredményt adó scraper rosszabb, mint egy hangosan hibázó.

**Udvariassági szabályok** (a `src/lib/scrapers/http.ts`-ben):
beszédes User-Agent, 20 mp-es időkorlát, azonos kiszolgálóra legalább 1 mp
várakozás két kérés között, `robots.txt` figyelembevétele, és 6 órás lemezes
gyorsítótár a `data/.cache/` alatt. A `.cache/` bármikor törölhető, a
következő futás újratölti.

### Az adat eredete: `schedule-sources.json`

A `pools.json`-t a `npm run build:dataset` generálja, ezért oda közvetlenül írni
hiába való — a következő build eltünteti. Az eredetet ezért külön fájl hordozza:

```jsonc
{
  "_comment": "…",
  "sources": {
    "csepeli-strandfurdo": {
      "type": "scraper",            // scraper | curated | none
      "adapter": "csepel-palyabeosztas",
      "url": "https://www.csepelistrandfurdo.hu/palyabeosztas/",
      "lastScrapedAt": "2026-09-24T16:45:27.401Z"
    }
  }
}
```

A `build-dataset.ts` ezt ráolvassa a `pools.json` alapértelmezett
`{"type":"none"}` forrására. **Ha egy uszoda nincs benne, a felület „Nincs
sávadat"-ot ír — akkor is, ha vannak blokkjai.**

A `npm run scrape` minden futásnál OLVAS–MÓDOSÍT–ÍR módon frissíti ezt a fájlt:

* csak a **sikeres** adapterek uszodája kap friss `lastScrapedAt`-et —
  a hibára futott adapter bejegyzéséhez nem nyúl, így a régi időbélyeg
  helyesen „öregszik" a felületen, ahelyett hogy frissnek hazudnánk;
* a `curated` típusú bejegyzéseket és a `_comment` kulcsot **nem írja felül**;
* a kézzel hozzáírt mezőket (`format`, `note`) megtartja.

### Jelenlegi adapterek

| Adapter | Uszoda | Forrás | Formátum |
| --- | --- | --- | --- |
| `bvsc-facilitypilot` | BVSC Laky Károly Sportuszoda | `letesitmeny.bvsc.hu` naptár | szerver oldali HTML táblázat |
| `csepel-palyabeosztas` | Csepeli Strandfürdő | `csepelistrandfurdo.hu/palyabeosztas/` | PDF, cellaszín |
| `tuskecsarnok-szabad-vizfelulet` | Tüskecsarnok | `tuskecsarnok.hu/sportuszoda/` | HTML szövegblokk |
| `tve-heti-program` | TVE 1887 Sportuszoda | `tve1887.hu/uszoda/` | PDF, cellaszín |
| `ujhegyi-palyabeosztas-pdf` | Újhegyi Uszoda | `kobanyasport.hu` létesítmény-oldal | PDF, cellaszín |

Új forrás bekötése: `src/lib/scrapers/adapters/` alá egy új modul, amely a
végén meghívja a `registerAdapter`-t, és egy sor import a
`src/lib/scrapers/index.ts`-ben. Az adapter **soha ne adjon vissza üres
sikeres eredményt**: ha nem tudja értelmezni a forrást, dobjon hibát.

---

## 4. Kézi (kurált) sávbeosztás felvitele és javítása

Van néhány uszoda, amely a legjobb minőségű beosztást publikálja, de **képként**
(Kispest PNG, Dagály JPG). Ezeket szemmel/képelemzéssel olvastuk ki, és kézzel
visszük a `blocks.json`-ba.

### A `curatedPools` védőkorlát

A `blocks.json` `curatedPools` tömbjébe felvett uszodák blokkjait a
`npm run scrape` **nem írja felül**, akkor sem, ha később valaki ír rájuk
adaptert (a futás ilyenkor „Kézi adat megtartva" üzenetet ír ki). Ha egy uszoda
átáll scraperre, **vedd ki az id-ját ebből a tömbből**, különben a scraper
eredménye soha nem kerül be.

### Menete

1. Nyisd meg a forrást (kép, PDF, nyitvatartási táblázat), és **írd fel az URL-t
   meg a dátumot**.
2. Olvasd ki, hogy az adott medencében egy adott idősávban **hány sáv foglalt**.
   Ha a forrás a *szabad* sávokat adja meg, vond ki a medence teljes
   sávszámából (`pools.json` → `basins[].lanes`).
3. Vedd fel a blokkokat a `blocks.json` `blocks` tömbjébe, az uszoda id-ját
   pedig a `curatedPools`-ba.
4. Ellenőrizd: `npx tsx -e "import {loadBlocks} from './src/lib/data'; console.log(loadBlocks().length)"`
   — ez a betöltéskori validációval együtt fut le.
5. Vedd fel az uszodát a `schedule-sources.json` `sources` kulcsa alá, különben
   a felület akkor sem mutatja az adatot, ha benne van a `blocks.json`-ban:

   ```json
   { "type": "curated", "url": "<a forrás URL-je>", "format": "image", "lastVerified": "2026-09-24" }
   ```

### A `lastVerified` szabály

**Minden kézzel felvitt uszodához kötelező `lastVerified` dátum a
`pools.json` `scheduleSource` mezőjében.** Kézi adatnál nincs `lastScrapedAt`,
tehát ez az egyetlen jel arról, hogy az adat mikor volt igaz. Aki hozzányúl egy
kurált beosztáshoz, **írja át a `lastVerified` dátumot arra a napra, amikor az
eredeti forrást ténylegesen megnézte** — akkor is, ha semmit nem kellett
változtatni.

### Mire figyelj a kézi felvitelnél

* **Soha ne találj ki beosztást.** Csak azt rögzítsd, amit a forrás kimond. Ha a
  forrás csak lakossági nyitvatartási ablakot ad (és nem sávonkénti bontást),
  akkor azt modellezd, és írd a `reason`-be, hogy ez nem sávszintű adat.
* **A dátumozott blokkok elévülnek.** A Kispest és a Dagály heti rácsot publikál,
  ezért ezek a blokkok egy konkrét hétre szólnak. Amint a forrás új hetet tölt
  fel, a régi blokkok törlendők/cserélendők.
* **Ha a jelmagyarázat két dolgot összevon** (a kispesti rács például a
  „Foglalt / Zárva" kategóriát nem bontja), akkor ne tippelj: válaszd az
  általánosabb `kind`-et, és írd meg a `reason`-ben, hogy a forrás a kettőt nem
  különbözteti meg.

---

## 5. Jelenlegi adatállapot

| Uszoda | Blokkok | Eredet | Érvényesség |
| --- | --- | --- | --- |
| `kispesti-uszoda` | 105 | **kézi**, `Savbeosztas-WEB-*.png` | 2026-09-21 – 2026-10-04 (két hét) |
| `tve-sportuszoda` | 50 | scraper (`tve-heti-program`) | 2026-09-21 – 2026-09-27 |
| `bvsc-laky-karoly-sportuszoda` | 27 | scraper (`bvsc-facilitypilot`) | aktuális hét |
| `csepeli-strandfurdo` | 25 | scraper (`csepel-palyabeosztas`) | heti ismétlődő, 2025/26 őszi-téli szezon |
| `dagaly-furdo-es-uszoda` | 19 | **kézi**, `*-palyabeosztas-*.jpg` | 2026-09-21 – 2026-09-27 |
| `tuskecsarnok-sportuszoda` | 6 | scraper (`tuskecsarnok-szabad-vizfelulet`) | 2026-09-21 – 2026-09-27 |
| `ujhegyi-uszoda` | 0 | scraper (`ujhegyi-palyabeosztas-pdf`) | a forrás a futtatáskor nem volt elérhető |

A többi `pools.json`-beli uszodához **nincs sávbeosztás**, mert nem publikálnak
ilyet. Ez nem hiba az adatkészletben, hanem a valóság: a felületen ezeknél
tisztességesebb azt mondani, hogy „nincs adat", mint szabad sávokat állítani.
