# Lemme swim

Webalkalmazás, amely megmutatja, hogy a **hozzád legközelebbi budapesti uszodákban hány úszósáv szabad** abban az időpontban, amikor úszni indulnál.

A felület teljes egészében magyar. Kiindulási pontként Budapest 23 kerülete közül lehet választani; a légvonalbeli távolságot a kerület középpontjától számoljuk. Nincs címbevitel vagy böngészős helymeghatározás. A fejlécben váltható világos és sötét megjelenés, a választást a böngésző megjegyzi.

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

## Production Deployment

[The deployment workflow](.github/workflows/deploy.yml) hosts the full Next.js app
on Vercel, including the search and geocoding API routes. GitHub Pages is not
suitable because these routes need a server runtime.

### One-Time Setup

1. Create a Vercel project for this repository with the **Next.js** framework
	 preset, repository root directory, Node.js **24.x**, build command
	 `npm run build`, and install command `npm ci`.
2. Disconnect the project's Git integration in Vercel after creating it, or
	 otherwise disable its automatic Git deployments. GitHub Actions must be the
	 only production publisher, so another deployment cannot bypass the checks.
3. In GitHub, create an environment named `production`. Add these environment
	 secrets under **Settings > Environments > production**:

	 | Secret | Value |
	 | --- | --- |
	 | `VERCEL_TOKEN` | A Vercel access token allowed to deploy and promote this project |
	 | `VERCEL_ORG_ID` | The Vercel team/account ID (`orgId` when linking with the CLI) |
	 | `VERCEL_PROJECT_ID` | The Vercel project ID (`projectId` when linking with the CLI) |

	 Project IDs are available in Vercel settings or the local `.vercel/project.json`
	 created by `npx vercel@64.3.1 link`. Never commit the token. Configure any app
	 environment variables in Vercel's **Production** environment. The CLI smoke
	 checks automatically handle Vercel deployment protection; the token must also
	 have permission to obtain an automation bypass token for the project.
4. Merge the workflow and lockfile into the repository's default branch. Run
	 **Actions > Refresh Data and Deploy > Run workflow** on that branch for the
	 first release. Use Vercel's assigned `*.vercel.app` URL until buying a domain.
	 Production environment approval rules, if enabled, must be approved on each
	 run; leave required reviewers disabled for unattended daily releases.
5. Enable GitHub Actions failure notifications for this repository. A failed
	 refresh is intentionally a failed workflow, not a silently successful run.

### Daily Refresh and Failure Handling

- The workflow starts at **06:00 Europe/Budapest** every day, automatically
	following daylight saving time. It also runs on default-branch pushes and can
	be started manually. Other branches cannot deploy to production.
- Every registered scraper runs with its HTTP cache disabled. Pool data is
	normalized before scraping and rebuilt afterward so fresh source timestamps
	reach the website. Manually curated schedules still require manual updates;
	pools without a registered scraper cannot be refreshed automatically.
- Tests must pass, **every scraper must succeed**, and the production build must
	succeed. Any failure or scrape timeout stops the release; partially refreshed
	files are discarded with the runner, and the existing site and data stay live.
- A successful build is uploaded with `--skip-domain`. The workflow checks the
	staged homepage and search API before promoting that exact deployment to the
	production domains. A failed staging or smoke check leaves production alone.
- Releases are serialized and active releases are not canceled by later runs.
	Data is bundled into each immutable deployment, not modified on the live site.
	There are no daily commits or runtime scrape requests from visitors.
- If the promotion command itself times out, Vercel may still finish promotion;
	check its dashboard before retrying. For a runtime issue that escaped the
	checks, use Vercel's **Instant Rollback** to restore a known working deployment.
	Smoke tests reduce risk but cannot guarantee that every feature works.

06:00 is the scheduled start, not a guarantee that new data is live at that
instant: scraping, tests, and building take time, and GitHub can delay scheduled
runs. The workflow must remain on the default branch. GitHub can disable
schedules in public repositories after 60 days without repository activity;
monitor Actions and re-enable them when necessary. GitHub Actions and Vercel
usage are subject to their plans and limits.

### Custom Domain Later

After purchasing `lemme-swim.com`, open **Vercel > Project > Settings > Domains**
and add `www.lemme-swim.com` and, optionally, the apex `lemme-swim.com`. Enter the
DNS records Vercel provides at your registrar, wait for verification and HTTPS,
and redirect the apex to `www` if that is the preferred address. Keep the domain
assigned to this project's **Production** environment.

Optionally set the GitHub `production` environment variable `PRODUCTION_URL` to
`https://www.lemme-swim.com` (or the current Vercel URL). This changes the link
shown in GitHub's deployment environment; it does **not** configure DNS or buy
the domain. Future successful releases automatically use all production domains
assigned in Vercel, so no workflow edit is needed when the domain changes.

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
