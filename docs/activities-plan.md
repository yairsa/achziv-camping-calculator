# Activities tab — plan

> **Open questions for Yair:** none yet. The decisions below were derived from the brief (30/09/2026). Say if any is wrong.

**Status:** designed 30/09/2026. **Not built.** Build **after** the tips tab (`docs/tips-plan.md`), because both change the same files (`Code.source.gs`, `app.js`, `index.html`). Next: first unticked box in §5.1.

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
| **פעילויות** | id · status (פעיל / הוסתר / בוטל) · owner family · topic · description · start · end · tag · age from · age to · capacity · required equipment · suggested equipment · created · updated |
| **הצטרפויות** | activity id · family · participants · updated |

The organizers' sheet gets an **פעילויות** tab (topic, time, owner, joined / capacity), synced the same way as families.

## 5. Tasks (not started)

#### 5.1 Backend
- [ ] Tabs `פעילויות` / `הצטרפויות`, created on first use
- [ ] Actions: `activities` (public read, with join counts and names), `saveActivity`, `deleteActivity`, `join`, `leave`
  - every write checks family name + code and that the family is registered (not cancelled)
  - capacity enforced inside the script lock, so two last joins can't both succeed
  - client id so a retried save doesn't create a duplicate
- [ ] Organizers' sheet: `פעילויות` tab in `syncOrganizers_`
- [ ] Tests in `tests/backend.test.js`
- [ ] Gate: `node tests/backend.test.js` green, `python backend/build.py --check` clean

#### 5.2 Site
- [ ] Tab **פעילויות**: list-by-day view + filters (day, tag, text)
  - position: right after **ציוד** in the tab row (Yair, 30/09/2026: *"Events tab will be after ציוד"*)
- [ ] Calendar view (desktop all days; phone 3 days with arrows)
- [ ] Details panel: join / leave / edit / delete
- [ ] Add / edit form: topic, description, start/end (end defaults to the start day), tag + ages, capacity, equipment ×2
- [ ] Uses the registration name + code; "ההרשמה שלי" fills them in when already loaded on this device
- [ ] Gate: headless browser run at 360px: add → join → full → leave → edit → delete; no horizontal scroll

#### 5.3 Go-live
- [ ] Yair pastes the new `Code.gs` and deploys a new version
- [ ] Live check with a test family, then clean up
