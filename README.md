# Uszoda Tracker

Webalkalmazás, amely megmutatja, hogy a **hozzád legközelebbi budapesti uszodákban hány úszósáv szabad** abban az időpontban, amikor úszni indulnál.

A felület teljes egészében magyar. A távolságot mindig a böngésző helymeghatározásából számoljuk (légvonalban), de az alkalmazás helymegosztás nélkül is használható: kerület vagy cím megadásával.

---

## Miért nem triviális ez

A budapesti uszodák a sávbeosztásukat (*sávrend*, *vízfelület-beosztás*) nagyon különböző módon teszik közzé: van, aki HTML-táblázatban, van, aki PDF-ben, van, aki beszkennelt képen, és van, aki csak Facebookon. Ezért **hibrid** megoldást használunk:

| Forrás | Mit jelent |
|---|---|
| `scraper` | Gépi olvasású forrásból automatikusan lekért adat |
| `curated` | Kézzel rögzített, dátummal ellenőrzött adat |
| `none` | Nincs sávbeosztásunk — csak nyitvatartást mutatunk |

**Az alkalmazás sosem tesz úgy, mintha biztosabbat tudna, mint amennyit valóban tud.** Minden medencénél megjelenik, honnan származik az adat és mikor ellenőriztük utoljára:

- **Friss adat** — 48 óránál frissebb scraper-futás
- **Ellenőrzött · dátum** — 60 napnál frissebb kézi ellenőrzés
- **Régi adat** — van adatunk, de elavulhatott
- **Nincs sávadat** — ilyenkor **egyáltalán nem írunk ki szabad sávszámot**, csak a nyitvatartást és az uszoda saját beosztására mutató linket

---

## Két tervezési döntés, amit érdemes tudni

**1. A szabad sávok száma a legrosszabb esetet mutatja, nem az átlagot.**
Ha egy sáv a kért idősáv közepén elfogy, azt a sávot nem ígérjük oda. A kért ablakot a foglalások határai mentén részintervallumokra bontjuk, és a legkevesebb szabad sávot adó rész számít. Ha 18:00–19:00-ra keresel, és 18:30-tól edzés kezdődik, azt látod, ami 18:30 után marad.

**2. A „nem tudjuk” nem ugyanaz, mint a „nulla”.**
Ha egy medence sávszáma ismeretlen, `null`-t tárolunk, és a felület nem mutat számot. Sosem tippelünk sávszámot vagy koordinátát: a hiteles forrásból nem igazolt érték `null` marad.

---

## Indítás

```bash
npm install
npm run dev          # fejlesztői szerver: http://localhost:3000
```

További parancsok:

```bash
npm test             # a keresőmotor tesztjei (vitest)
npm run build        # éles build
npm run scrape       # a scraperek futtatása, az adatfájlok frissítése
```

---

## Felépítés

```
src/lib/types.ts        A projekt adatszerződése — minden más ehhez igazodik
src/lib/geo.ts          Légvonalbeli távolság, magyar távolságformázás
src/lib/time.ts         Időkezelés, ISO hétköznap, magyar dátumnevek
src/lib/availability.ts Az elérhetőség-motor: hány sáv marad ténylegesen szabadon
src/lib/search.ts       Szűrés és távolság szerinti rendezés
src/lib/data.ts         Az adatfájlok betöltése és validálása
src/lib/scrapers/       Scraper-keretrendszer és uszodánkénti adapterek
src/app/api/search/     Kereső API-végpont
src/components/         A magyar felület komponensei
data/                   Az uszoda- és sávfoglalás-adatok (lásd data/README.md)
scripts/scrape.ts       A scraperek futtatója
```

A `src/lib/types.ts` a közös szerződés: a scraperek ilyen alakú adatot állítanak elő, a motor ilyet fogyaszt, a felület ilyet jelenít meg.

---

## Adatok javítása, bővítése

Az uszodaadatok a `data/` könyvtárban vannak, és szándékosan emberi kézzel is szerkeszthetők. Új uszoda felvételéhez, sávbeosztás javításához és az ellenőrzési dátum szabályaihoz lásd: **[`data/README.md`](data/README.md)**.

Egy szabály mindenekelőtt: **ha egy értéket nem tudsz hiteles forrásból igazolni, hagyd `null`-on.** A rossz koordináta rosszabb a hiányzónál — oda küldi a felhasználót, ahol nincs uszoda.
