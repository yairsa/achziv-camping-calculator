# Achziv camping calculator — instructions

Static RTL site on GitHub Pages (`main` = live, about 1 minute after a push; no CI, no cost) plus a Google Apps Script backend bound to Yair's registration sheet. Live at https://yairsa.github.io/achziv-camping-calculator/

## Gates — run before every commit
- `node tests/calc.test.js` · `node tests/backend.test.js` · `python backend/build.py --check` · `node tests/tips.e2e.js` · `node tests/gear.e2e.js` (headless Chrome, backend mocked; uses the website repo's `playwright-core`, or set `PLAYWRIGHT_CORE`)
- `python tools/stamp.py --check`. **After changing any script or `style.css`, run `python tools/stamp.py`.** It content-hashes their URLs in `index.html`, because Pages lets browsers cache files for 10 minutes, so a new page could run with an old script.
- UI changes: drive the page in headless Chrome (Playwright with `executablePath` = the installed Chrome) at 360px width. Check for no horizontal scroll and no page errors. Mock `https://script.google.com/**` with `backend/Code.gs` running in Node's `vm` — never create test data in the live sheet except for a deliberate live check, and delete it afterwards.

## Backend — the gotchas that cost hours on 30/09/2026
- **Edit `backend/Code.source.gs`, then run `python backend/build.py`.** `Code.gs` is generated, pure ASCII with Hebrew as `\u` escapes. Pasting Hebrew into Yair's Apps Script editor either broke the syntax or stored it reversed. Don't try Hebrew in `Code.gs` again.
- **Never give Yair Hebrew to copy from the terminal.** It displays reversed and copies reversed. Hand him `Code.gs` via the clipboard: `Get-Content -Raw backend\Code.gs | Set-Clipboard`.
- **Backend changes go live only after Yair pastes the code and deploys a new version** (Deploy → Manage deployments → New version; the URL stays the same). That step is always his. Hand it to him with the file on his clipboard.
- **New Google permissions are requested on the first run from the sheet menu, not at deploy time.** A missing permission fails silently in `syncOrganizers_` (by design, so registrations keep working).
- **About 1 in 3 web-app replies are dropped by Google** (a 404 page after the script already ran). Every action must be safe to repeat. The site retries up to 4 times, and a delete that finds `not_found` on a retry counts as success.
- The registration sheet holds codes (hashed) and raw data: **never share it**. Organizers get the separate synced sheet (see `backend/SETUP.md`).
- **Code shared by site and backend lives once**: `search.js` is loaded by the page and inlined into `Code.gs` by `build.py` at `//@include search.js`.
- **Tooling:** `\uXXXX` typed into a Write/Bash input arrives as the literal character, and bash heredocs holding Hebrew failed to parse. Edit Hebrew files with the Edit tool. Raw Hebrew in a JS regex class is fine, because `build.py` escapes it.
- Sheets reads "06/10" as a month-first date. Write night labels with a weekday prefix (`ג׳ 06/10`).

## Site
- Prices live only in `prices.js`, taken from parks.org.il. Dates display day-first; storage is ISO.
- In RTL, "06/10–07/10" displays reversed. Write ranges as "06/10 עד 07/10".
- **Fast on the client; the server works in the background** (Yair, 30/09/2026). Show the browser's cached copy at once, then refresh in the background. Prefetch data a tab will need. A submission appears at once and goes into a localStorage outbox, which is retried and resumed on the next visit. Only waits that need the server's verdict stay, such as a registration's code check. `tips.js` is the reference.
- Public by design: registered family names and people per night. Never prices per family, codes, or calculator details.

## Work queue
Plans with task lists live in `docs/`: `tips-plan.md`, `gear-plan.md`, `activities-plan.md`, `admin-plan.md` (future). Tick boxes in the same commit as the code.
