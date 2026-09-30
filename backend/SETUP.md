# Switching registration on (about 5 minutes, once)

Registration is stored in a Google Sheet that you own. Until this is done the site works as a plain calculator, and the registration card says "not active yet".

1. Create a new Google Sheet, for example "אכזיב 2026 — הרשמות", with the Google account that should own the data.
2. In the sheet: **Extensions → Apps Script**. Delete what is there, paste the full contents of `backend/Code.gs`, and save. That file is generated and pure ASCII (Hebrew written as `\u` codes), because pasting Hebrew into the editor reversed it. To change the script, edit `Code.source.gs` and run `python backend/build.py`.
3. **Deploy → New deployment →** type **Web app**.
   - *Execute as:* **Me**
   - *Who has access:* **Anyone**. Visitors don't log in; the PIN protects each entry.
4. Approve the permissions prompt. Google warns that the app is unverified: **Advanced → Go to (project)**. The script only touches this one sheet.
5. Copy the **Web app URL** (`https://script.google.com/macros/s/…/exec`) into `prices.js` → `apiUrl: '…'`, then commit and push.

The first save creates a tab named **הרשמות**: one row per family, with the display name, last update, people per night, and the full and group price.

- **Group total:** the site's "הקבוצה עד עכשיו" card sums people per night. The sheet has the same data per family.
- **Locked entry:** 5 wrong codes lock that name for 15 minutes. To unlock it sooner, set its "ניסיונות כושלים" cell to 0.
- **Forgotten PIN:** delete their row; they register again.
- **Changing Code.gs later:** Deploy → Manage deployments → edit → *New version*. The URL stays the same.

PINs are stored only as salted SHA-256 hashes; the salt is kept in the script's properties. So a forgotten code can't be recovered. That's why the site offers families "copy / send to myself on WhatsApp / by email" right after they save.

**Public by design:** the list of registered names (for the name dropdown) and the people-per-night totals. Prices, codes and calculator details are not public.

## Organizers' sheet (safe to share)

A **separate** Google Sheet the script keeps up to date after every registration, update or cancellation. It's separate because sharing a sheet shares all its tabs, and the registration file holds the codes.

- **משפחות:** one row per family, with name, status (רשום / בוטל), dates, people per night, adults, children, toddlers, discounts, and full and group price. The columns **שולם (₪)** and **הערות מארגנים**, and any column organizers add after them, are never touched by the script. A family that cancels keeps its row, marked בוטל, so a recorded payment isn't lost.
- **לילות:** people and families per night, and whether the night reaches 30.
- **סיכום:** registered and cancelled counts, price totals, and the total paid.

**Connect it once:** in the registration sheet, reload the page, then **מארגנים → חיבור לגיליון המארגנים** and paste the organizers' sheet link. **מארגנים → סנכרון עכשיו** refreshes it by hand.

This part of the script opens a second spreadsheet, so Google asks for the wider "spreadsheets" permission once, on the next deployment.

## Tips (טיפים) — approving

Tips and comments land in two tabs of the **registration** sheet, **טיפים** and **תגובות**. The script creates them the first time anyone opens the tips tab or submits something. Nothing reaches the site until you approve it.

- **Approve:** set the row's **סטטוס** dropdown to **מאושר**. The site shows it within about 5 minutes. The script fills in the **אושר** time itself.
- **Reject:** **נדחה**. **Take down later:** **הוסתר**. Rows are never deleted.
- **Near-duplicate:** the **דומה ל…** column shows the closest existing tip. Set **סטטוס** to **מוזג** and type that tip's number in **מוזג לטיפ**. The script adds the text as a comment on that tip, so nothing is lost.
- **Fix a typo or category:** just edit the cell. Categories are a dropdown.
- **Email alerts:** **מארגנים → הפעלת התראות**, once. Google then asks for the email and trigger permissions. Every 2 hours the script checks, and if something *new* arrived it sends you one email listing everything waiting. If nothing new arrived, there's no email, so an item you leave waiting on purpose doesn't nag you.
- **Limits:** a title of up to 60 characters, a tip of up to 400, a comment of up to 300. When 200 items are waiting, new submissions are refused until you clear some.

## Guided tours (הדרכה) — editing the bubbles

Every tour bubble's title and text is in the **הדרכה** tab of the **registration** sheet. The script creates the tab, filled with the site's current texts, the first time the site asks for them (or when you run **מארגנים → הפעלת התראות**).

- **Edit:** change **כותרת** or **טקסט**. The site picks it up within about 5 minutes, the next time a visitor opens a tour (a tour already open doesn't change mid-way).
- **Format:** plain text. An empty line (Ctrl+Enter twice inside the cell) starts a new paragraph, and `**like this**` is bold. HTML is shown as plain text, not run.
- **Back to the original:** clear the cell. An empty **כותרת** or **טקסט** shows the site's built-in text, so a bubble is never empty.
- **The tab follows the site:** when a step is added or the order changes on the site, the script puts the rows in the site's order and adds the new step's row. Your text moves with its row.
- **Don't change** **סיור** or **מפתח**: they tie a row to its step, and where its arrow points stays in the site's code. A row with an unknown key is ignored, so adding or removing steps isn't possible from the sheet.
