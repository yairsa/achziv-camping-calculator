# Guided tour, disclaimer and share — plan

> **Open questions for Yair:** none. The decisions in §2 were derived from the brief (30/09/2026). Say if any is wrong.

**Status:** built and live 30/09/2026 (df81317). All of §4 ticked.

## 1. The brief (Yair, 30/09/2026)

> lets add an arrow-bubble tutorial for new visitors, explaining the main site's features
> the first tutorial welcomes the visitor, shows the tab, and explains how to fill up the calculator - scroll the different sections
> 3 more tutorials - ציוד, פעילויות, טיפים - launch at first viewing of the relevant tab.
>
> important - stress that no personal info is getherd/saved, and that this site is only advisory. not connected to the camping orgenizers, and not caliming any liability. ט.ל.ח
> a kind of: use for your own benefit, if you find it valuable
>
> add share a firend button to the UI
> open modal offering to share after first registering

## 2. Decisions (derived: object if wrong)

| topic | decision | why |
|---|---|---|
| **Shape** | Coach marks: a bubble with an arrow pointing at the real element, which is highlighted (a dimmed page with a cut-out). Buttons: הבא · הקודם · דלג, plus "1 מתוך 6". Esc and דלג close it. The page scrolls so the target sits under the fixed tab row (`--tabs-h`) | "arrow-bubble" |
| **When** | The welcome tour runs on the first visit. Each tab tour runs the first time that tab opens. Each is remembered in localStorage (`achziv-tour-v1`: `{welcome, gear, acts, tips}`), so it is shown once, whether finished or skipped. A tab tour waits until the welcome tour is closed | "launch at first viewing" |
| **Replay** | A small **?** button in the header replays the current tab's tour (the welcome tour on מחשבון) | Someone who skipped it can get it back |
| **Welcome tour** | (1) welcome + the disclaimer (below) · (2) the tab row · (3) §1 מי מגיע · (4) §2 מתי · (5) §3 כמה זה עולה · (6) מחירון · (7) §4 שמירת ההרשמה (optional, name + code) · (8) share button | "welcomes, shows the tab, explains the calculator, scrolls the sections" |
| **Tab tours** | ציוד: pick vs my list, search/tags, basic items, packing, own item. פעילויות: list/calendar, filters, a row opens details, join, add (registered only). טיפים: search/category, write a tip (after approval) | One short tour each, 3 to 5 steps |
| **Disclaimer wording** | **Accurate, not literal.** The site does save a little: the registration keeps the family name the visitor chose, the headcount and the dates, with the code stored hashed. So the text says: *no personal details are collected (no phone, email or ID number). The equipment list stays in your browser only. A registration saves only the name you chose, the headcount and the dates, to count the group.* A flat "nothing is saved" would be untrue | Stress privacy, truthfully |
| **Advisory / liability** | *An unofficial, advisory site made by a group member for the group. It is not connected to רשות הטבע והגנים or the campground, and makes no commitment. The price at the till is what counts. ט.ל.ח. Use it if you find it useful.* It appears in the welcome step, and permanently in a short site-wide note (the calculator's price note stays as it is) | As in the brief. "the camping organizers" is read as the campsite operator (the park authority), since the group's own organizer is the site's author |
| **Share button** | A **"שיתוף עם חברים"** button in the header, beside ?. It uses `navigator.share` when the device has it (phones), otherwise a small menu: WhatsApp · copy link. The shared text is one line plus the site URL, with no personal data | "share a friend button" |
| **Share after registering** | After the **first** successful registration (`res.created`) on this device, a modal: "נרשמתם! רוצים לשתף את האתר עם משפחות נוספות מהקבוצה?" with the same share actions + "לא עכשיו". Shown once (localStorage) | "open modal after first registering" |
| **Code** | New `tour.js` (the tour engine + the four tours as data) and `share.js`. Hooks from `app.js`: a `tabshown` event when a tab is selected, and a `registered` event on save. Run `python tools/stamp.py` after | Keep app.js small; the tours are data, easy to edit |

## 3. Guard rails

- 360px: the bubble must stay fully on screen (flip above/below, clamp sideways), no horizontal scroll, and never cover its own target.
- It must not break the existing e2e tests. Each existing test sets the tour flags as seen before loading (or a `?notour` switch), so the old tests stay as they are.
- RTL: the arrow and the placement logic follow `dir="rtl"`. Dates stay day-first.
- Reduced motion: no smooth scrolling under `prefers-reduced-motion`.

## 4. Tasks

#### 4.1 Tour engine
- [x] `tour.js`: steps `{target, title, text, top}`, highlight + bubble + arrow, next/back/skip, step counter, Esc, focus into the bubble and back after, scroll the target into view under the fixed bars
- [x] Seen-flags in `achziv-tour-v1`. The welcome tour on the first visit; tab tours on the first `tabshown` of that tab, queued behind the welcome tour
- [x] **?** button in the header: replay the current tab's tour
- [x] Styles in `style.css`, light and dark; stamp

#### 4.2 Content
- [x] Welcome tour (8 steps, §2), with the disclaimer in step 1
- [x] ציוד, פעילויות, טיפים tours
- [x] The permanent short disclaimer note on the site (all tabs), wording as §2

#### 4.3 Share
- [x] `share.js`: header button, `navigator.share` or a WhatsApp / copy-link menu
- [x] The modal after the first successful registration, shown once

#### 4.4 Gate
- [x] `tests/tour.e2e.js` (headless, 360px, backend mocked): welcome tour on the first visit, every step's target visible and not covered by its bubble, skip is remembered, each tab tour runs once on first opening, ? replays, no horizontal scroll, no page errors. Share: the button, and the modal once after the first save only
- [x] Existing e2e tests skip the tours; all 9 suites green; add `node tests/tour.e2e.js` to the gates in `CLAUDE.md`
- [x] Push (Pages is live about 1 minute later), then check the live page headlessly — df81317, live after ~50s; read-only check: welcome 8 steps, gear tour, share menu, note, no horizontal scroll, no page errors

#### Notes from the build (30/09/2026)
- **Headings do not get the panels' `scroll-margin`**: it is set on `.card` and `[id]` only, so `scrollIntoView` put an `h2` target under the tab row and the calculator's bar. `bringIn()` in `tour.js` measures the bars that are pinned now (excluding a bar that holds the target) and scrolls the target just below them, re-measuring, since the scroll itself can pin a bar. Mutation-checked: going back to `scrollIntoView` reddens `tour.e2e.js` ("target under a fixed bar").
- **The arrow is its own fixed element**, not a child of the bubble: the bubble has to scroll inside when neither side of the target has room, and a scrolling box clips a child that sticks out.
- **Tab tours wait for their content** (`ready`, up to 6s): the tips tools and the activity rows appear only after the data loads. A step whose target is still missing is left out, and the counter counts only the steps shown.
- **The other suites opt out with `window.ACHZIV_NOTOUR`** set by an init script. That survives every `goto` and `localStorage.clear()` in those tests, where seen-flags would not.
- The share modal's "once" is its own flag (`achziv-shared-offer`), mutation-checked ("the modal a second time").
- **Between steps: fade out, smooth scroll, fade in** (Yair, 30/09/2026: *"add quick fade out -> arrow scroll -> quick fade in animation for orientation"*). `move()` in `tour.js`: 150ms fade, the shield keeps the page dimmed while the lit hole is out, the scroll's end point is measured by jumping and undoing in one frame, then a smooth scroll and a 150ms fade in. Under `prefers-reduced-motion` it is the plain jump. `tour.e2e.js` checks both.

## 5. Tour text editable in the sheet

> Yair, 30/09/2026: *"add the tutorial text to the google sheets(?) - so i can manually edit each bubble"*

### Decisions (derived: object if wrong)

| topic | decision | why |
|---|---|---|
| **Where** | A new tab **הדרכה** in the registration spreadsheet, next to טיפים / ציוד. Created with today's text on the first request, the same way the ציוד tab is seeded from `gear-seed.js` | The tabs he already edits by hand; nothing new to share |
| **Columns** | סיור · מספר צעד · מפתח · כותרת · טקסט. He edits כותרת and טקסט only. מפתח ties a row to its step in `tour.js` (the arrow's target is code) | Text is his; where the arrow points stays code |
| **Text format** | Plain text. A blank line starts a new paragraph. `**...**` is bold (the "לידיעתכם:" / "פרטיות:" labels). No HTML: the site escapes everything | Easy to type in a cell, and a cell can never inject markup into the page |
| **Empty cell / unknown key** | An empty כותרת or טקסט falls back to the built-in text. A row whose מפתח is unknown is ignored. Adding or removing steps is **not** supported from the sheet | A cleared cell must never leave an empty bubble |
| **Shared once** | The texts move out of `tour.js` into `tour-texts.js`, which the page loads and `build.py` inlines into `Code.gs` (`//@include tour-texts.js`), like `search.js` and `gear-seed.js` | The seed and the site's defaults can't drift apart |
| **Fast** | Backend action `tour` (cached 300s like `gear`, cache cleared by the existing edit trigger). The site shows its cached copy, or the built-in text, at once and refreshes in the background; a tour already open is not changed mid-way | The repo's "fast on the client" rule |
| **Scope** | The bubbles only. The permanent note under the page (`.site-note` in `index.html`) stays in code | As asked; say if he wants the note there too |
| **Deploy** | Backend change → **Yair pastes `Code.gs` and deploys a new version** (Code.gs on his clipboard). Until then the site keeps the built-in text; the old script answers `bad_request`, which is treated as "no sheet text" | Always his step (repo `CLAUDE.md`) |

### Tasks

#### 5.1 Shared texts
- [x] `tour-texts.js`: every tour's steps as `{tour, key, title, text}` in the plain format above; `tour.js` keeps only targets by key and renders the text (escape, blank line → paragraph, `**` → bold)
- [x] Built-in behaviour unchanged: `tour.e2e.js` green; stamp

#### 5.2 Backend
- [x] `Code.source.gs`: `//@include tour-texts.js`; tab הדרכה seeded on first use; action `tour` → `{ok, steps:[{tour,key,title,text}]}` with empty cells dropped; cached; the edit trigger clears the cache for this tab too
  - `tour` is in each row too: keys repeat across tours (`search`, `add`). The סיור column shows a Hebrew name (`TOUR_NAMES_` in `tour-texts.js`)
- [x] `backend.test.js`: seed, an edited row wins, an empty cell falls back, an unknown key is ignored; `python backend/build.py`
- [x] `SETUP.md`: the tab and how to edit it

#### 5.3 Site
- [x] Fetch `tour` in the background (after the page settles), cache in localStorage, merge over the built-in text for the next tour shown
  - fetched 2s after load, also under `?notour` (so ? replays get it)
- [x] `tour.e2e.js`: an edited title/text from the mocked sheet shows in the bubble; bold and paragraphs render; HTML in a cell shows as text; the old script (`bad_request`) keeps the built-in text

- [x] Welcome tour reordered (Yair, 30/09/2026: *"the מחירון bubble should be after the tabs bubble, then we continue with how to fill the form; the 2nd bubble should explain the tutorial is available through the ? button"*): hello → **? button** (new step `help`, the arrow on the button) → tabs → מחירון → the form → share. The "? replays" line moved from the last bubble to step 2. Now 9 steps

- [x] The tab follows the site (`tourSync_`): Yair deployed the first Code.gs, so הדרכה was made in the old order without the `help` row, and the seed-once design would never have added it. On read, a missing step gets its row in its place, rows take the site's order and numbering, hand edits move with their row, a cell still holding a retired built-in text (`TOUR_RETIRED_`) gets the new one. Needs another paste and deploy

#### 5.4 Gate and go-live
- [x] All 9 gates green; push; live check (built-in text, since the old script is still deployed) — 78f3a9f; live 30/09: built-in text with bold, nothing cached (old script), no errors, no sideways scroll at 360px
- [ ] Hand Yair `Code.gs` on the clipboard to paste and deploy a new version. Then a live check that the tab הדרכה appears and an edit shows on the site
