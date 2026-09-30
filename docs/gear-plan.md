# Personal equipment list — plan

> **Open questions for Yair:** 1 — [Q1 sections](#q1) (not blocking: built with the proposal, easy to change).

**Status:** built and on the site, 30/09/2026 (Yair's brief below). The site uses the starter list until Yair deploys the new `Code.gs` (§5.3).

## 1. The brief (Yair, 30/09/2026)

> My personal equipment list. We build a list of all relevant and optional items, by sections (maybe use the tip list for sections). The list is a tick list. Each visitor can tick their own relevant items, to create their personal list. Items can be filtered by text/tag. Personal list: a tick list for packing (check if packed, it moves to the bottom of the list, also by sections). Add personal items: a user can add a personal item (under a section). These items are sent digested to me (with the tip mail), for deciding whether to add the item to the general list, and under which section. The list updates in the background.

## 2. Design

A fifth tab, **ציוד**, with two views:

| view | what it does |
|---|---|
| **בחירת פריטים** | The general list by section, as a tick list. Ticking an item puts it on my list. Filter by text (the same Hebrew word search as tips) and by tag chips. Sections fold, showing "ticked / total". A button adds every **בסיסי** item at once. |
| **הרשימה שלי (N)** | Only the ticked items, by section. Ticking here means **packed**: the item moves to the bottom of its section, struck through. Shows progress ("ארוזים 12 מתוך 30"), a reset for the packing marks, and copy / WhatsApp of the list. |

- **Personal items:** a small form (section + name) under both views. The item goes onto my list **at once**, and is sent to Yair as a suggestion in the background (the tips outbox pattern: resent until the server answers, resumed on the next visit).
- **Everything personal stays in this browser** (localStorage): picks, packing marks, personal items. There are no accounts, and nothing about a visitor's list reaches the server except the suggested item's name and section.
- **The general list lives in the registration sheet**, tab **ציוד**, so Yair edits it like the tips. The columns are: מספר · סטטוס · קטגוריה · פריט · תגיות · הערה · נשלח · אושר · מזהה שליחה.
  - **The starter list is written into the tab by the script** the first time the tab is created (~120 items, from `gear-seed.js`).
  - **A suggestion is a row with status ממתין.** Yair decides by setting מאושר (and fixing the קטגוריה if needed). That row then joins the general list for everyone. נדחה keeps it only on the suggester's own list. הוסתר takes any item off the list.
  - When a visitor's own suggested item is approved, their personal copy merges into the general item: the same row id, still ticked, and packed if it was.
- **The digest email** (every 2 hours, with tips and comments) gains a section: "פריטי ציוד שהוצעו".
- **Fast on the client** (the repo rule): the site ships the same starter list (`gear-seed.js`, shared with the backend like `search.js`), so the tab works instantly on a first visit, even before the new `Code.gs` is deployed. After that it shows the cached copy, and the fresh list arrives in the background.
- **Tags** (small, fixed set in the starter list; Yair can type others in the sheet): בסיסי · ילדים · תינוקות · נוחות.
- **The starter list respects the site rules:** no hammock (no ropes between trees), no speaker (no music), gas bottle up to 10 kg, no glass, and notes where the campsite already provides something (charging points, fridges, carts).

[]()<a id="q1"></a>**Q1 — sections.** The tip categories, minus הגעה וחניה (not a packing section), plus **ביגוד** (the largest part of packing). ציוד appears as **ציוד כללי**. Order follows packing, not the tip list: אוהלים ולינה · ביגוד · אוכל ובישול · ים וחוף · מקלחות ושירותים · ילדים · בטיחות · חשמל ותאורה · סלולרי ומחשבים · ציוד כללי · שונות. OK, or change?
<Yair: >

## 3. Limitations

| limitation | what it means |
|---|---|
| **The list is per browser** | A family packing on two phones has two lists. Syncing a list through the family's registration code is possible later, but it is not in v1. |
| **Clearing the browser data clears the list** | The same as any site without accounts. The copy/WhatsApp button is the backup. |
| **An item Yair hides disappears from personal lists too** | It is no longer part of the list. Rare, and on purpose. |

## 4. Backend

- Actions: `gear` returns the approved items, cached for 5 minutes and cleared on every hand edit of the tab. `submitGear` takes {clientId, section, name, hp} and creates a pending row. It is safe to repeat, has the bot trap, and shares the 200 pending cap with the tips.
- The digest and `housekeep_` (approval stamp) cover the tab. `onEdit` clears the cache.

## 5. Tasks

#### 5.1 Backend
- [x] `gear-seed.js`: starter list (section, item, tags, note), shared by the site and `Code.gs` via `//@include`
  - 101 items, `GEAR_SECTIONS_` + `GEAR_SEED_`, item N = row id N. Included in `Code.source.gs` under the gear section.
  - **Site implementation notes (from the planning session):** `gear.js`, modelled on `tips.js` (outbox + cache + badges). localStorage `achziv-gear-v1` = {picked:{id:1}, packed:{key:1}, custom:[{cid, id|null, section, name, at, failed?, body}]}. Keys are `g<id>` / `c<cid>`. On approval, a custom item whose `id` is in the general list merges into it (picked + packed carried over). If the tab bar overflows at 360px with 5 tabs, shorten "על המקום ונגישות".
- [x] `ציוד` tab: created and seeded on first use, with status and category dropdowns
  - seed rows carry "רשימה התחלתית" in אושר, so `housekeep_` does not stamp 101 rows one by one. A store with no `gear` (old mocks) reads as empty via `gearRows_`.
- [x] Actions `gear` (cached, `GEAR_CACHE`) and `submitGear`; pending cap shared with the tips
  - `submitGear` returns the row id; the site keeps it on the custom item and merges once that id appears in the public list. A section typed by hand in the sheet is appended to `sections`.
- [x] Digest section for suggested items (`seen.gear`); approval stamp; `onEdit` watches ציוד and clears both caches
- [x] Tests in `tests/backend.test.js` ("gear tests")
- [x] Gate: `node tests/backend.test.js` green, `python backend/build.py --check` clean

#### 5.2 Site
- [x] Tab **ציוד**: the "בחירת פריטים" view (sections, ticks, text + tag filter, add all בסיסי)
  - tags are single-select chips. With 5 tabs the bar overflowed at 360px by ~20px: "על המקום ונגישות" is now "על המקום" and phone tab padding is 6px.
- [x] The "הרשימה שלי" view: packed → bottom of its section, progress, reset, copy / WhatsApp
- [x] Personal items: form, shown at once, outbox to `submitGear`, merge on approval
  - the outbox sends only after a `gear` read succeeded, so the old live script is not retried every few seconds. An own item can be removed with "הסרה".
- [x] Starter list shown instantly; cached copy, then fresh in the background
- [x] Yair, 30/09/2026: *"List should start collapsed. Allow clear selections in general list, same as clear packed"*
  - the general list opens folded; a section opened by hand stays open through redraws; a search or tag opens every section with a match. "הרשימה שלי" stays open (it is the packing view).
  - "ניקוי כל הבחירות" (with a confirm) clears every pick and its packed mark; own items stay (they have their own "הסרה").
- [x] Gate: `node tests/gear.e2e.js` (headless Chrome, 360px, mocked backend) + all other gates
  - mutation-checked: disabling the merge, or packed-to-bottom, turns it red.

#### 5.3 Go-live
- [ ] Yair pastes the new `Code.gs` and deploys a new version (same URL). Until then the site uses the starter list, and suggestions wait in the outbox.
- [ ] Live check: the `gear` action answers with the seeded list
