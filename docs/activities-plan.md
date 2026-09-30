# Activities tab — plan

> **Open questions for Yair:** none yet. The decisions below were derived from the brief (30/09/2026). Say if any is wrong.

**Status:** live 30/09/2026: the backend is deployed and the tab is open. All of §5 is done. The 3 demo activities are live. Until then the live tab says "הפעילויות ייפתחו בקרוב" (the live script answers `bad_request`). The same paste also ships the equipment backend (gear-plan §5.3).

## 1. The brief (Yair, 30/09/2026)

- Registered families can add an activity they plan.
- Each activity has a start and end date and time (the end defaults to the same day), a topic, a description, a total capacity, and equipment (if relevant: required or suggested).
- Tag: all / adults / kids (with an age range).
- View as a list by day, or as a calendar. Clicking a row or a calendar event opens its details.
- Search by date and tag.
- Only registered families can update.

## 2. Decisions (derived — object if wrong)

| topic | decision | why |
|---|---|---|
| **Who is "registered"** | The same family name and code as the registration. No new accounts. | One identity to remember. The code already has lockout protection. |
| **Approval** | None. A registered family's activity goes live immediately. Yair can hide one from the sheet (status `הוסתר`). | The brief restricts by registration, not by approval, unlike tips. |
| **Edit / delete** | Only the family that created it, with its code. Deleting an activity that has participants asks for confirmation first. | Nobody else's plans can be changed. |
| **Capacity** | Optional; empty means unlimited. Registered families **join** with a number of participants, and the card shows "12 of 20". A full activity takes no more joins. | Capacity means nothing without sign-ups. |
| **Who joined** | Shown as family names and counts. | Names are already public (the registration dropdown). Useful for kids' activities. |
| **Tag** | `לכולם` / `מבוגרים` / `ילדים` + optional ages "from" and "to". | As in the brief. |
| **Equipment** | Two short text fields: **חובה להביא** and **מומלץ להביא**. | As in the brief. |
| **Dates** | Limited to the trip (06/10 to 13/10/2026). 24-hour clock, day-first dates. Overlapping activities are allowed. | Parallel activities for adults and kids are normal. |
| **Registration link** | Adding or joining needs the family to be registered, and not cancelled. | "Registered only". |

## 3. Views

- **List by day** (the default, and best on a phone): day headers (ג׳ 06/10 …), each activity as a row showing time · topic · tag · places left.
- **Calendar:** days as columns and hours as rows, events as blocks. Desktop shows all trip days. A phone shows 3 days at a time, with ‹ › arrows.
- **Click a row or block** to open a details panel: description, time, tag and ages, equipment, capacity and who joined, and join / leave / edit buttons.
- **Filters:** day chips (הכל · 06/10 · 07/10 …), tag chips, and a free-text search reusing the tips tab's Hebrew normaliser.

## 4. Data (registration sheet — raw, never shared)

| tab | columns |
|---|---|
| **פעילויות** | id · status (פעיל / הוסתר / בוטל) · owner family · topic · description · start · end · tag · age from · age to · capacity · required equipment · suggested equipment · created · updated · client id · host (מנחה, optional) |
| **הצטרפויות** | activity id · family · participants · updated |

The organizers' sheet gets an **פעילויות** tab (topic, time, owner, joined / capacity), synced the same way as families.

## 5. Tasks

#### 5.1 Backend
- [x] Tabs `פעילויות` / `הצטרפויות`, created on the first write (a read never creates them, because the organizers' sync reads on every registration). Start and end are plain-text cells (`2026-10-06T10:00`), so Sheets cannot turn them into dates. A `מזהה שליחה` column was added for the client id.
- [x] Actions: `activities` (public read, cached 5 minutes and cleared on every write and on a hand edit of either tab), `saveActivity`, `deleteActivity`, `join`, `leave`
  - every write checks family name + code (the registration's lockout applies); `not_registered` if there's no such family
  - capacity enforced inside the script lock: `full`; an edit can't drop capacity below who already joined: `below_joined`
  - client id so a retried save doesn't create a duplicate; `join` *sets* the family's count (never adds), and `leave` / `deleteActivity` are repeatable
  - `deleteActivity` = status `בוטל` (the row and its joins stay on record); ages are kept only for tag `ילדים`; up to 30 active activities per family (`busy`)
  - every write answers with the fresh public list, so the site needs no second request
- [x] Organizers' sheet: `פעילויות` tab in `syncOrganizers_` (when · topic · family · audience · joined · capacity · who joined), rewritten on every sync, also after activity writes
- [x] Tests in `tests/backend.test.js` (mutation-checked: removing the capacity check, the client-id dedupe, the owner check or the end-before-start check each turns it red)
- [x] Gate: `node tests/backend.test.js` green, `python backend/build.py --check` clean

#### 5.2 Site
- [x] Tab **פעילויות**: list-by-day view + filters (day, tag, text): `activities.js`
  - no day chosen: each activity under its first day. A day chosen: everything happening on it, so a night activity shows on both days. Next-day ends read "21:00 עד 01:00 (למחרת)", because a date inside a time range scrambles in RTL
  - the tag filter **מבוגרים** or **ילדים** also shows **לכולם** activities (they suit both). **לכולם** shows only those
  - the list shows at once from this browser's copy (`achziv-acts-cache`) and is refreshed in the background (prefetched after page load)
  - position: right after **ציוד** in the tab row (Yair, 30/09/2026: *"Events tab will be after ציוד"*)
- [x] Calendar view (desktop all days; phone 3 days with arrows)
  - the hours run 08:00–22:00, widened by whatever starts or ends outside them. The tail of last night's activity is a short "עד 01:00" block at the top, so the day does not stretch to 00:00
  - overlapping activities sit side by side (lanes). The phone switch is at 700px
- [x] Details panel: join / leave / edit / delete, in a `<dialog>`
  - **writes wait for the server's verdict (no outbox)**: each one needs the code checked or a free place, and the reply carries the fresh list. `api()` retries a dropped reply, which is safe because every write repeats cleanly
  - the edit and cancel buttons show when the known name is the owner's (the server enforces it anyway). Cancelling always asks first, and the question names the participant count when there are any
- [x] Add / edit form: topic, description, start/end (end defaults to the start day), tag + ages, capacity, equipment ×2
  - times are hour and minute selects (00/15/30/45), so every browser shows a 24-hour clock. The end follows the start (same day, an hour later) until it is changed by hand
- [x] Uses the registration name + code; "ההרשמה שלי" fills them in when already loaded on this device
  - `CampApi.me()` in app.js gives the name + code loaded in this visit. Otherwise the name this device registered with is filled in. The code is kept in memory for the visit only, never stored. "החלפה" switches family
- [x] Gate: headless browser run at 360px: add → join → full → leave → edit → delete; no horizontal scroll: `tests/activities.e2e.js`, plus the tab order in `tests/layout.e2e.js`
  - mutation-checked: the day overlap, keeping the accepted code, the phone paging and the registration prefill each turn it red

#### 5.2b Additions (Yair, 30/09/2026: *"Create 3 demo events. Give event bg color by participants characteristic"*)
- [x] Each audience has its own colour (לכולם green, מבוגרים blue, ילדים orange, with dark-mode variants) on calendar blocks, list rows, the tag text and the filter chips. The chips serve as the legend. A full activity has a dashed edge in the calendar
- [x] Three demo activities, one per audience, owned by "המארגנים" (no family can edit them). They come from the sheet menu **מארגנים → הוספת 3 פעילויות לדוגמה**, which is safe to run twice. Hide one with status `הוסתר`
  - a menu item, because the live script is not deployed yet and a write through the site needs a family's code. Tested in `tests/backend.test.js`: each demo passes the same checks as a family's own activity
- [x] Preview link **`?demo#acts`** (Yair was away from the computer, 30/09/2026): shows the same three demos (`acts-demo.js`, also inlined into Code.gs) in this browser only. Nothing is sent, cached or saved, and a join or save says so. Live: https://yairsa.github.io/achziv-camping-calculator/?demo#acts
- [x] Gate: all 8 suites green

#### 5.2c Additions (Yair, 30/09/2026: *"Each event should have מנחה field, optional"* · *"Calendar view — show only relevant days/hours"*)
- [x] **מנחה** (optional, one line, up to 60 characters): a new last column `מנחה` in the פעילויות tab, a field in the form, a line in the details, the list row and the search. Also a column in the organizers' tab
- [x] Calendar shows only the days that have an activity (after the filters), and only the hours that have one. A run of empty hours folds into a thin hatched divider (⋯). A phone pages 3 of those days at a time
- [x] Gate: all 8 suites green. Mutation-checked: showing empty days, keeping empty hours and not sending the host each turn the e2e red

#### 5.3 Go-live
- [x] Yair pastes the new `Code.gs` and deploys a new version. Done 30/09/2026; the live `activities` action answers `ok` with an empty list
- [x] Yair opens the sheet: menu **מארגנים → הוספת 3 פעילויות לדוגמה** (the menu appears after a reload of the sheet)
- [x] ~~Live check with a test family, then clean up~~ — dropped 30/09/2026. A test registration and its join leave rows in the live sheet that only a hand edit removes (a cancel keeps its row by design). The write logic is covered by the vm tests on this same `Code.gs`, and running the demo menu exercises the live sheet store (tab creation, writing, reading back)
- [x] After the menu has run: read the live list back and confirm the 3 demos (a session, read-only). 30/09/2026: 3 activities (ids 1 to 3), times kept as text, owner המארגנים, capacity and ages right. The live page at 360px shows them in the list and in a 3-day calendar, with no horizontal scroll and no page errors
