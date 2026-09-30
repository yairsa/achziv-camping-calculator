# Managing page — plan (future)

> **Open questions for Yair:** none. Q1 was answered 30/09/2026: one password per organizer (§2).

**Status:** recorded 30/09/2026 as a **future task**. Build after tips and activities.

## 1. The brief (Yair, 30/09/2026)

A managing page: add or select a family, set dates, record payment received. It must be comfortable on a phone. Not Google Sheets edits, where cells can be deleted by mistake.

## 2. Design

- **`admin.html`** on the same site, phone-first. Not linked from the public page.
- **Login:** a password checked by the script, never stored in the site. The script hands back a short-lived session (a few hours), kept only in that browser tab. Wrong passwords lock out, as with family codes.
  []()**Q1 — one shared password for all organizers, or one each?** One each means we can see who recorded which payment.
  <Yair: one each>
  **Decided:** one password per organizer, so each payment entry records who made it.
- **Families:** search or select, add a family on someone's behalf, and edit dates and headcount through the same calculator logic, so prices stay consistent.
- **Payments are an append-only log**, never a cell to overwrite: amount · method · date · organizer · note. A mistake is fixed with a correcting entry, so nothing can be deleted by accident. The organizers' sheet's **שולם** column becomes the total from this log.
  - ⚠️ **Migration:** until this exists, organizers type payments into the organizers' sheet by hand. When the log goes live, those amounts get imported into it once, then that column becomes read-only.
- **Also useful here:** mark a family as arrived, and hide or restore activities and tips.

## 3. Tasks (not started)
- [ ] Admin auth in the script: password hash in Script Properties, session token with expiry, lockout
- [ ] `payments` tab (append-only) + actions: list families, add/edit family (admin), add payment, list payments
- [ ] One-time import of payments already typed into the organizers' sheet
- [ ] `admin.html`: login, family list/search, family page (dates, headcount, payments), add-payment form
- [ ] Organizers' sheet: **שולם** column computed from the log
- [ ] Gate: backend tests + headless browser run at 360px
