# Switching registration on (about 5 minutes, once)

Registration is stored in a Google Sheet that you own. Until this is done the site works as a plain calculator, and the registration card says "not active yet".

1. Create a new Google Sheet, for example "אכזיב 2026 — הרשמות", with the Google account that should own the data.
2. In the sheet: **Extensions → Apps Script**. Delete what is there, paste the full contents of `backend/Code.gs`, and save.
3. **Deploy → New deployment →** type **Web app**.
   - *Execute as:* **Me**
   - *Who has access:* **Anyone**. Visitors don't log in; the PIN protects each entry.
4. Approve the permissions prompt. Google warns that the app is unverified: **Advanced → Go to (project)**. The script only touches this one sheet.
5. Copy the **Web app URL** (`https://script.google.com/macros/s/…/exec`) into `prices.js` → `apiUrl: '…'`, then commit and push.

The first save creates a tab named **הרשמות**: one row per family, with the display name, last update, people per night, and the full and group price.

- **Group total:** the site's "הקבוצה עד עכשיו" card sums people per night. The sheet has the same data per family.
- **Unlocking a family** after 5 wrong PINs: set their "ניסיונות כושלים" cell to 0.
- **Forgotten PIN:** delete their row; they register again.
- **Changing Code.gs later:** Deploy → Manage deployments → edit → *New version*. The URL stays the same.

PINs are stored only as salted SHA-256 hashes; the salt is kept in the script's properties.
