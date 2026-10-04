# Personal equipment list — plan

> **Open questions for Yair:** none (hand-kept). Q1 was answered by his 04/10 request, §5.4.

**Status:** live, 30/09/2026 (Yair's brief below). The backend is deployed, and the live list is the seeded one (§5.3).

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
<Yair: (answered by the 04/10 request: the new order is in §5.4)>

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
- [x] Yair, 30/09/2026: *"In ציוד, keep list toggle and filters fix on top"*
  - one bar fixed under the tab row: the toggle, plus search + tags in the picking view (only the toggle in "הרשימה שלי"). The search label is screen-reader only, to keep the bar ~150px at 360px. A search typed from deep in the list scrolls the results up to just under the bar.
- [x] Gate: `node tests/gear.e2e.js` (headless Chrome, 360px, mocked backend) + all other gates
  - mutation-checked: disabling the merge, or packed-to-bottom, turns it red.

- [x] Yair, 30/09/2026: *"The items list is not showing in the general view"* — the list was there, folded: `display: flex` on `<summary>` hid the browser's arrow, so 11 folded headers read as an empty list. Fixed with a drawn chevron on every header and a "פתיחת / סגירת כל הקטגוריות" button; the e2e checks the arrow exists.

#### 5.2b Expanded starter list
- [x] Yair, 30/09/2026: *"Lets expand ציוד list. Use [his Google Doc 'רשימת קמפינג'] as reference. Make specific items (like תרופה ספציפית) to general (תרופות)"*
  - 101 → 117 items. Specific items made general in place (תרופות, ציוד רפואי אישי, הלבשה תחתונה…); new items appended as ids 102-117, because ids 1-101 were already live and ticks are stored by id. A backend test pins id 101 = ספר.
  - left out on purpose: **כבל מאריך / מפצל** (the park forbids extension cables and there is no electricity); specific foods (אבוקדו, טופו, בירה…) became food groups.

#### 5.3 Go-live
- [x] Yair pastes the new `Code.gs` and deploys a new version (same URL). Done 30/09/2026 (Yair: *"deployed"*)
- [x] Live check: the `gear` action answers with the seeded list (30/09/2026: 117 items, ids 1-117 match `gear-seed.js`; read-only)

#### 5.4 Per-person list with counters (Yair, 04/10/2026) — not started
> *"i want to enhance the ציוד list 1. add any new item from this list: C:\Family\Camping\CampWebsite\docs\רשימת קמפינג כללית_261004_145323.docx 2. reorder and expand general sections - sleep exuipement: bed sheets should be expendable: סדין, ציפה, שמיכה, כרית, ציפית, מזרן... - cloths: חולצה, גופיה, מכנסיים, חזייה, תחתונים, גרביים 3. add people by name 4. each row (item - סיר) should have a counter 5. personal items: חולצה, should be selected by family member. create a buttom - same for all. if i choose 4 חולצה, i can make sure it is 4 חולצות for every family member"*

Constraints carried from above: ids are sheet row ids and visitors' localStorage ticks point at them, so **never renumber** — new items are appended (next id 118+), and a general item split into specific ones keeps its id on one of them. The live list is the sheet's ציוד tab (seeded once from `gear-seed.js`), so new seed items reach the live site only through the backend (a seed-append step, or the managing page's add). Any `Code.gs` change goes on Yair's clipboard unasked.

- [x] Design + task list for this section (write before code): read the docx, diff against the 117 items, the new section order, the per-person data model (people by name in localStorage, a count per item, personal items × people with a "same for all" button), migration of existing ticks
  - live list read 04/10 (read-only): 117 approved items, max id 117.

**Design (04/10/2026)**

*Sections* — 13, in the order of Yair's docx (בסיס · שינה · מים · לבוש · טואלטיקה · כלי מטבח · משחקים · אוכל), then the rest:
אוהלים ומחנה · **שינה** (new) · ים וחוף · ביגוד · מקלחות ושירותים · מטבח ובישול · ילדים · **אוכל** (new) · בטיחות · חשמל ותאורה · סלולרי ומחשבים · ציוד כללי · שונות.
Two renames: אוהלים ולינה → אוהלים ומחנה (sleep moved out), אוכל ובישול → מטבח ובישול (food moved out). A rename applies to **every** row with the old name (Yair's own and suggested rows too), and a visitor's own item or an outbox send with an old name is mapped to the new one. This answers Q1.

*Items* — ids never change; edits happen in place, new items get ids **1001+** (a separate block, because suggested rows may already hold 118+, unseen by the public read).
- שינה: שק שינה, מזרן, משאבה, כרית, שמיכה (ids 4-8) move here; "מצעים (סדין, ציפית)" (9) becomes **סדין**; new: ציפית, ציפה לשמיכה, כרית מתנפחת.
- ביגוד: "בגדים להחלפה לכל יום" (16) becomes **חולצה**, "הלבשה תחתונה וגרביים" (17) becomes **תחתונים**; new: גופייה, מכנסיים קצרים, חזייה, גרביים, חולצה ארוכה (his "סט ארוך").
- מטבח ובישול: "סיר ומחבת" (27) becomes **סיר** (his counter example); new: מחבת, מסננת, כוסות לשתייה חמה, פותחן בקבוקים, מפה לשולחן, מתקן ייבוש לכלים, כפפות לשטיפת כלים.
- אוכל: the food rows move here (36, 37, 39, 40, 107-110); new: חלב או חלב צמחי, רטבים ורסק עגבניות, חלבון לבישול (נקניקיות, טופו).
- also new: אסלה ניידת, אוהל שירותים (מחנה) · סבון ידיים, קרם לחות (מקלחות) · ערכת יצירה, גירים, לגו או משחקי הרכבה, אוהל כדורים לפעוטות (ילדים) · תוספי תזונה (בטיחות).
- left out on purpose: ערסל (no ropes between trees), מפוחית (no music), the specific remedies and foods (already general: תרופות, מצרכים יבשים, ממרחים).
- new tag **לכל אחד** marks a per-person item: the bedding, every clothing item, בגד ים, מגבות, כפכפים למקלחת, בקבוק מים אישי, פנס ראש. ("אישי" was taken: it already labels a visitor's own item.)

*Reaching the live sheet* — `gearUpgrade_` runs on the `gear` read (already under the script lock on a cache miss) and on the managing page's gear list: renames sections, applies each in-place edit **only if the cell still holds the old starter value** (a hand edit by Yair wins), appends the 1001+ rows (`seed-<id>` in מזהה שליחה, so it happens once), and refreshes the קטגוריה dropdown. Idempotent, so a dropped reply or a second run changes nothing.

*This browser's list* — still `achziv-gear-v1`, extended, so **existing ticks need no migration**:
- `people: [{pid, name}]` — "מי נוסע?" names, added and removed in the picking view.
- `qty: {key: n}` — the count; absent = 1. For a לכל אחד item it is the count **per person**.
- `pq: {key: {pid: n}}` — only when the counts differ between people. **"אותו מספר לכולם"** sets `qty` to the number just chosen and deletes `pq[key]`: 4 חולצות for everyone. 0 for a person = they don't need it.
- with no people added, a לכל אחד item behaves like any other item.
- packing: one line per item, and for a לכל אחד item one line **per person** (key `g12@pid`). "הרשימה שלי" gets person chips (הכל · משותף · each name), so a child's bag can be packed, copied or sent on its own.

**Tasks**

- [ ] `gear-seed.js`: new section order, `GEAR_SECTION_RENAMES_`, rows 1-117 edited in place, `GEAR_SEED_MORE_` (1001+), tag לכל אחד; `GEAR_UPDATES_` lists every in-place edit with its old value
- [ ] Backend: `gearUpgrade_` (renames, guarded edits, append, dropdown) on the `gear` read and the managing page's gear list; `submitGear` and admin edits map an old section name
- [ ] Tests in `tests/backend.test.js`: upgrade on a v1 tab, idempotent, a hand-edited cell left alone, a suggestion with an old section
- [ ] Gate: `node tests/backend.test.js` green, `python backend/build.py --check` clean
- [ ] Site: "מי נוסע?" names (add, remove)
- [ ] Site: a counter on every picked item; for a לכל אחד item, per-person counters with "אותו מספר לכולם"
- [ ] Site: "הרשימה שלי" — counts, a line per person, person chips; copy / WhatsApp follow the chosen person
- [ ] Site: own items and outbox sends with an old section name show and send under the new one
- [ ] Gate: `node tests/gear.e2e.js` extended (people, counters, same-for-all, per-person packing, a v1 state loads unchanged), all repo gates, 360px with no horizontal scroll; `python tools/stamp.py`
- [ ] Go-live: `Code.gs` on Yair's clipboard; **Yair** pastes and deploys a new version
- [ ] Live check (read-only): `gear` answers with 13 sections and the 1001+ items
