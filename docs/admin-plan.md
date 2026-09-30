# Managing page — plan

> **Open questions for Yair:** none. The decisions in §2 are derived; say if one is wrong.

**Status:** planned 01/10/2026, not started. Next: the first unticked box in §4.

## 1. The brief (Yair, 01/10/2026)

> *"i don't want to use the registration sheet. i'll be on my mobile, and need to control all activities by phone (registration too, but not payments). in my vision - see the waiting list, review each item separately, decide (option to modify text / sections (for tips for instance), approve etc). i'll also like to be able to modify any current item in the sheet (even the tutorial text)"*

**🔴 Supersedes the 30/09/2026 plan** (kept at the bottom, §6), whose centre was a payments log. Yair, 01/10/2026: *"is the admin UI only for payments? if so, don't build it"*, then this brief. **Payments are out.** The sheet stays the store; this page is how he works on it from a phone.

## 2. Decisions (derived: object if wrong)

| topic | decision | why |
|---|---|---|
| **Where** | `admin.html` on the same site, phone-first, RTL, not linked from the public page. Its own small script `admin.js`; shares `app.js`'s `api()` retry and `esc()` pattern | One site, one deploy (a push) |
| **Login** | A password checked by the script. Stored as a salted hash in Script Properties, never in the repo or the site. Set once from the sheet menu **מארגנים → סיסמת ניהול** (a prompt), the same menu that already installs alerts. One password per organizer (Yair's 30/09 answer, kept): each has a name, and every change records who made it | Nothing secret in a public repo |
| **Session** | Login returns a signed token (organizer + expiry, HMAC with a key in Script Properties) valid **7 days**, kept in this phone's localStorage; a logout button clears it. Changing that organizer's password invalidates its tokens. 5 wrong passwords lock login for 15 minutes, like family codes | On a phone, logging in every visit is friction; 7 days + revocation is the balance |
| **Waiting list** | Home screen: everything pending, newest first, one card each — tips, comments, suggested gear items — with a count per kind. Activities need no approval (activities-plan §2), so they are not in it | "See the waiting list" |
| **Review one item** | Tapping a card opens it alone: every field editable (a tip's title, text, category from the list; a comment's text; a gear item's name, section, tags, note), then **אישור** · **דחייה** · for a tip **מיזוג לטיפ…** (pick the target, the same `mergedInto` the sheet uses). Saving edits and the decision is one write | "Review each item separately, decide, with the option to modify" |
| **Edit anything current** | A tab per kind — טיפים · תגובות · ציוד · פעילויות · הדרכה · הרשמות — listing every row with search; tap to edit fields and status (הוסתר / restore). Tour texts: title and text per bubble, the same plain format | "Modify any current item … even the tutorial text" |
| **Registrations** | List families (name, nights, people per night, updated). Edit dates and headcount **through the calculator's own logic** (`prices.js` + the calc code), so prices stay consistent; cancel a registration; **unlock** a family locked by wrong codes. **Never show or reset a code** — a family that forgot its code cancels and re-registers, or the organizer cancels for it | Codes are hashed and stay secret; prices come from one place |
| **Safety** | Every admin write appends a row to a new **יומן ניהול** tab: when · organizer · kind · id · field · old value · new value. Nothing is deleted (status changes only, as today). Writes set values (never toggle), so a retried write is harmless — about 1 in 3 replies is dropped by Google | No undo button needed to recover; the log has the old value |
| **Fast** | The page shows its cached copy at once and refreshes in the background. A decision waits for the server's verdict (it must be recorded), then the card leaves the list | The repo's "fast on the client" rule, with the verdict exception it allows |
| **Caches** | Each admin write clears the public cache it affects (tips, gear, activities, tour), so the site shows it within a minute | Same as the sheet's edit trigger |
| **Deploy** | Backend → Yair pastes `Code.gs` and deploys a new version, then sets his password from the menu once. Until then the page says the server is not updated yet | Always his step |

## 3. Out of scope
- Payments (Yair, 01/10/2026). The organizers' sheet keeps its hand-typed שולם column.
- Adding or removing tour steps (where an arrow points stays code, tour-plan §5).
- Showing, resetting or choosing a family's code.

## 4. Tasks

#### 4.1 Auth
- [ ] Script Properties: organizers `{name, salt, hash, ver}` + an HMAC key; menu **מארגנים → סיסמת ניהול** (name + password prompts, adds or replaces that organizer, bumps `ver`)
- [ ] Actions `adminLogin {name, password}` → `{token, name, exp}` · every admin action checks the token (signature, expiry, `ver`); lockout after 5 wrong passwords per name, 15 minutes
- [ ] `backend.test.js`: right / wrong password, lockout and its expiry, expired token, token after a password change, a forged token
- [ ] Gate: backend tests green, `python backend/build.py --check`

#### 4.2 Waiting list and review
- [ ] Action `adminQueue` → pending tips (with the "דומה ל…" hint), comments (with their tip's title), gear items; counts
- [ ] Action `adminDecide {kind, id, fields, status, mergedInto?}`: validates fields with the same limits as submissions, writes fields + status in one update, stamps אושר, appends to יומן ניהול, clears the public cache; repeatable
- [ ] `admin.html` + `admin.js`: login screen, the waiting list (cards, counts), one item's review screen, logout; cached copy at once
- [ ] Tests: backend (each kind, each decision, a merge, bad fields, no token) + `tests/admin.e2e.js` at 360px (backend in vm, mocked URL): login, review a tip with an edited category, approve → gone from the list and public, reject a comment, approve a gear item, a dropped reply retried
- [ ] Gate: all gates green; stamp

#### 4.3 Edit anything current
- [ ] Actions `adminList {kind}` / `adminUpdate {kind, id, fields, status}` for tips, comments, gear, activities, tour texts; same validation, log and cache rules
- [ ] `admin.html`: a tab per kind with search; the edit screen per kind (activities: every field incl. times inside the trip, status פעיל / הוסתר; tour: title + text, preview rendered with tour.js's format)
- [ ] Tests: backend per kind + e2e: hide and restore a tip, fix an activity's time, edit a tour bubble and see it on the public page
- [ ] Gate: all gates green

#### 4.4 Registrations
- [ ] Actions `adminFamilies` (name, nights, people per night, updated, locked?) · `adminFamilyUpdate {user, nights, maxPeople, data}` recomputing prices with the calculator logic · `adminFamilyCancel` · `adminFamilyUnlock`; the organizers' sheet re-syncs after each
- [ ] `admin.html`: the families tab; a family's screen reusing the calculator form (dates, headcount, discounts) and its price
- [ ] Tests: backend (update keeps the code, cancel, unlock; codes never in any reply) + e2e
- [ ] Gate: all gates green

#### 4.5 Go-live
- [ ] Push; live check of the page (login screen, "server not updated yet" with the old script)
- [ ] Hand Yair `Code.gs` on the clipboard: deploy a new version, then **מארגנים → סיסמת ניהול** once. Then a live check together: log in on his phone, the waiting list loads
- [ ] `SETUP.md`: the managing page replaces the sheet sections for day-to-day work (the sheet sections stay as the fallback)

## 5. Log
- 01/10/2026 — planned (this file). The 30/09 payments plan superseded.

## 6. ~~The 30/09/2026 plan~~ — superseded 01/10/2026 (payments are out; see §1)

> Kept for the record. Its login decision (one password per organizer) carries over to §2; the rest does not.

~~A managing page: add or select a family, set dates, record payment received. It must be comfortable on a phone. Not Google Sheets edits, where cells can be deleted by mistake.~~

- ~~**`admin.html`** on the same site, phone-first. Not linked from the public page.~~
- ~~**Login:** a password checked by the script, never stored in the site. The script hands back a short-lived session (a few hours), kept only in that browser tab. Wrong passwords lock out, as with family codes.~~ Q1 — one shared password or one each? `<Yair: one each>` — **carried over.**
- ~~**Families:** search or select, add a family on someone's behalf, and edit dates and headcount through the same calculator logic.~~ (carried over to §4.4, without adding on someone's behalf)
- ~~**Payments are an append-only log** … the organizers' sheet's **שולם** column becomes the total from this log, with a one-time import.~~ — dropped.
- ~~**Also useful here:** mark a family as arrived, and hide or restore activities and tips.~~ (hide/restore carried over to §4.3; "arrived" dropped)
