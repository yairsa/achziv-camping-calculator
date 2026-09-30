# Guided tour, disclaimer and share — plan

> **Open questions for Yair:** none. The decisions in §2 were derived from the brief (30/09/2026). Say if any is wrong.

**Status:** planned 30/09/2026, not started. Next: first unticked box in §4.

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
- [ ] `tour.js`: steps `{target, title, text, place}`, highlight + bubble + arrow, next/back/skip, step counter, Esc, focus into the bubble and back after, scroll the target into view under the fixed bars
- [ ] Seen-flags in `achziv-tour-v1`. The welcome tour on the first visit; tab tours on the first `tabshown` of that tab, queued behind the welcome tour
- [ ] **?** button in the header: replay the current tab's tour
- [ ] Styles in `style.css`, light and dark; stamp

#### 4.2 Content
- [ ] Welcome tour (8 steps, §2), with the disclaimer in step 1
- [ ] ציוד, פעילויות, טיפים tours
- [ ] The permanent short disclaimer note on the site (all tabs), wording as §2

#### 4.3 Share
- [ ] `share.js`: header button, `navigator.share` or a WhatsApp / copy-link menu
- [ ] The modal after the first successful registration, shown once

#### 4.4 Gate
- [ ] `tests/tour.e2e.js` (headless, 360px, backend mocked): welcome tour on the first visit, every step's target visible and not covered by its bubble, skip is remembered, each tab tour runs once on first opening, ? replays, no horizontal scroll, no page errors. Share: the button, and the modal once after the first save only
- [ ] Existing e2e tests skip the tours; all 9 suites green; add `node tests/tour.e2e.js` to the gates in `CLAUDE.md`
- [ ] Push (Pages is live about 1 minute later), then check the live page headlessly
