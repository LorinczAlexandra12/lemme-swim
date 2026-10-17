# Lemme swim

Lemme swim shows **how many swimming lanes are available at nearby pools in Budapest** for the time you want to swim.

The application UI is in Hungarian. Choose one of Budapest's 23 districts as your starting point; distances are measured in a straight line from the district center. There is no address entry or browser geolocation. The header lets you switch between light and dark themes, and your choice is saved in the browser.

---

## Why This Is Challenging

Budapest's pools publish lane schedules (*sávrend* or *vízfelület-beosztás*) in many different formats: HTML tables, PDFs, scanned images, or sometimes only on Facebook. The project therefore uses a **hybrid** approach:

| Source | Meaning |
|---|---|
| `scraper` | Data fetched automatically from a machine-readable source |
| `curated` | Data entered manually and verified on a specific date |
| `none` | No lane schedule is available; only opening hours are shown |

**The app never claims more certainty than the data supports.** Each pool shows where its data came from and when it was last checked:

- **Fresh data** — scraped within the last 48 hours
- **Verified · date** — manually checked within the last 60 days
- **Stale data** — data is available, but may be out of date
- **No lane data** — **we never display an availability count**; we show only opening hours and a link to the pool's own schedule

---

## Two Important Design Decisions

**1. Available lanes show the worst case, not the average.**
If a lane becomes occupied partway through the requested time, we do not promise it for the whole session. We split the requested window at booking boundaries and show the fewest lanes available in any interval. For example, if you search for 18:00–19:00 and a class starts at 18:30, the result reflects availability after 18:30.

If a pool is open for only part of the requested window, it remains in the results. A warning shows when it opens, closes, or has a break, along with the intervals when it is actually open. Lane availability is calculated only during those open intervals. For example, a 06:00–08:00 search for a pool that opens at 07:00 shows availability from 07:00–08:00. Results are always ordered by distance, with pools of unknown distance at the end.

**2. “Unknown” is not the same as zero.**
If a pool's lane count is unknown, we store `null` and do not display a number. We never guess lane counts or coordinates; values that cannot be verified from a reliable source remain `null`.

## Getting Started

```bash
npm install
npm run dev          # development server: http://localhost:3000
```

Other commands:

```bash
npm test             # run the test suite (Vitest)
npm run build        # create a production build
npm run scrape       # run scrapers and update the data files
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

### Custom Domain

For `lemme-swim.hu`, open **Vercel > Project > Settings > Domains** and add
`www.lemme-swim.hu`. Add `lemme-swim.hu` too if you want the bare domain to
redirect to `www`. Copy the DNS records shown by Vercel into the domain's DNS
settings at your registrar. Wait for Vercel to verify the records and provision
HTTPS, and keep the domains assigned to this project's **Production** environment.

Optionally set the GitHub `production` environment variable `PRODUCTION_URL` to
`https://www.lemme-swim.hu`. This only sets the URL shown for the GitHub
deployment; it does **not** configure DNS or attach the domain to Vercel. The
workflow already promotes successful releases to every domain assigned to the
Vercel production project, so no workflow edit is needed.

---

## Project Structure

```
src/lib/types.ts        Shared data contracts used throughout the project
src/lib/geo.ts          Straight-line distance and localized distance formatting
src/lib/time.ts         Time handling, ISO weekdays, and localized date names
src/lib/availability.ts Availability engine: calculates how many lanes are free
src/lib/search.ts       Filters pools and sorts results by distance
src/lib/data.ts         Loads and validates the data files
src/lib/scrapers/       Scraper framework and pool-specific adapters
src/app/api/search/     Search API endpoint
src/components/         Hungarian-language UI components
data/                   Pool and lane-booking data (see data/README.md)
scripts/scrape.ts       Scraper runner
```

`src/lib/types.ts` defines the shared contract: scrapers produce this data shape, the availability engine consumes it, and the UI displays it.

## Updating the Data

Pool data lives in `data/` and is intentionally editable by hand. For instructions on adding pools, correcting lane schedules, and setting verification dates, see **[`data/README.md`](data/README.md)**.

One rule above all: **if a value cannot be verified from a reliable source, leave it as `null`.** Incorrect coordinates are worse than missing ones; they can send someone to a place with no pool.
