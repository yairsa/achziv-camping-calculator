# Camping tips tab — plan

> **Open questions for Yair:** none. Q1 and Q2 were answered 30/09/2026; the answers are in §4 and §5.

**Status:** designed and decided 30/09/2026. **Ready to build** — next: first unticked box in §6.1. Not live yet.

## 1. What it is

A fourth tab, **טיפים**, for the group's own camping tips.

- Anyone can **submit a tip**. Anyone can **comment** on an approved tip. Comments are a flat list, with no replies to comments.
- **Nothing goes live until Yair approves it**, tips and comments alike.
- Approved tips can be **searched by words**.
- **While someone writes a tip,** the page shows existing tips that share its main words, so the author can see whether it's already covered.

## 2. Is it possible — yes, on what we already have

Same Google Sheet and Apps Script as registration. Two new tabs in the registration sheet ("אכזיב 2026 — הרשמות"):

| tab | columns |
|---|---|
| **טיפים** | id · status · category · title · text · author (optional) · submitted · approved · merged into |
| **תגובות** | id · tip id · status · text · author (optional) · submitted · approved |

- **Approving = changing one cell.** The `status` column is a dropdown: `ממתין` → `מאושר` / `נדחה` / `מוזג`. No admin page and no admin password. The sheet is private to Yair, so approval can't be faked from the site.
- The site reads **approved rows only**. Pending and rejected rows never leave the sheet.
- The author's own browser remembers what they submitted and shows "ממתין לאישור", so a tip doesn't seem to vanish before approval.

## 3. Limitations — honest list

| limitation | what it means | what we do |
|---|---|---|
| **Search is word-based, not meaning-based** | "אוהל" won't find "יריעה". Hebrew prefixes (ה/ו/ב/ל/מ/ש/כ) and final letters would miss matches if ignored. | Normalise before matching: final letters → regular, strip niqqud, and try each word with and without one prefix letter. Good for a list of dozens to a few hundred tips. It is not smart search. |
| **Duplicate check only sees approved tips** | Two people submitting the same tip on the same day won't see each other. | Yair sees both in the sheet. The script also fills a "דומה ל…" column on each pending row with its closest existing tip, to help at approval time. |
| **No accounts** | Anyone can type any name, and a comment can't be edited or deleted by its author. | Name is optional and only shown as written. Corrections go through Yair, who edits the row. |
| **Public endpoint = possible junk** | Anyone with the site address can submit. | Moderation keeps junk off the site. On top: length limits, a hidden bot trap field, and a cap on pending items (e.g. 200) so the sheet can't be flooded. The script can't see visitor IPs, so there is no per-person rate limit. |
| **Google's flaky replies** (measured 30/09/2026, ~1 in 3) | A submit could look failed after it actually worked. | Same retry as registration, plus a client-side id so a retried submit updates the same row instead of creating a duplicate. |
| **Text only** | No photos. | Out of scope. A photo would need Drive uploads, more permissions and more moderation. |
| **Approval is manual** | Nothing appears until Yair looks. | See Q1 (a notification) — otherwise pending items wait until he opens the sheet. |

## 4. Keeping the list from exploding

1. **Fixed categories.** The author picks one; Yair can change it. Search and browsing both filter by category.
   []()**Q2 — proposed list:** ציוד · אוהלים ולינה · אוכל ובישול · ילדים · ים וחוף · מקלחות ושירותים · בטיחות · הגעה וחניה · שונות
   <Yair: add: סלולרי ומחשבים, חשמל ותאורה>
   **Decided:** ציוד · אוהלים ולינה · אוכל ובישול · ילדים · ים וחוף · מקלחות ושירותים · בטיחות · הגעה וחניה · סלולרי ומחשבים · חשמל ותאורה · שונות
2. **One tip = one idea.** Required short title (up to 60 characters) and a short text (up to 400). Long how-tos get split.
3. **Duplicate check while writing** (§1). The top 3 similar tips are shown with a "זה כבר קיים — להוסיף תגובה במקום?" button that jumps to commenting on the existing tip.
4. **Merge instead of reject.** When a near-duplicate arrives, Yair sets it to `מוזג` and picks the existing tip. The script then turns the text into a comment on that tip, so the author's addition isn't lost and the list doesn't grow.
5. **Comments stay short and collapsed.** Up to 300 characters, showing the latest 3 with "עוד N תגובות".
6. **Hide, never delete.** Outdated tips are set to `הוסתר`: off the site, still in the sheet.
7. **Maybe later — "מועיל" votes** to sort by usefulness. Left out of v1: it needs abuse protection of its own, and at this list size categories plus search are enough.

## 5. Notifications

[]()**Q1 — should the script email you when something is waiting for approval?** One email per new item, or one daily summary. It needs you to approve a Gmail permission for the script once, and emails go from your account to your account only. Without it, you check the sheet yourself.
<Yair: the script emails when something is waiting for approval - a 2 hour digest. give permission>
**Decided:** a time trigger runs every 2 hours. If anything is waiting (tips or comments, and later activities if they ever need approval), it sends one email to the sheet owner listing the waiting items, with a link to the sheet. Nothing waiting means no email. The trigger is installed from the sheet menu (**מארגנים → הפעלת התראות**), which is also where Google asks for the Gmail and trigger permissions.

## 6. Tasks (not started)

#### 6.1 Backend
- [ ] `טיפים` / `תגובות` tabs with status dropdowns, created by the script on first use
- [ ] Actions: `tips` (approved tips + approved comments, cached), `submitTip`, `submitComment`
  - length limits, bot trap field, pending cap, client id for safe retries
- [ ] "דומה ל…" column filled on each pending tip
- [ ] Merge: a `מוזג` status with a target id turns the tip into a comment on that tip
- [ ] 2-hour digest email: time trigger + menu item that installs it (Gmail + trigger permissions)
- [ ] Tests in `tests/backend.test.js`
- [ ] Gate: `node tests/backend.test.js` green, `python backend/build.py --check` clean

#### 6.2 Site
- [ ] Tab **טיפים**: category filter, search box, tip cards with collapsed comments
- [ ] Hebrew normaliser (final letters, niqqud, one-letter prefixes) + tests
- [ ] Write-a-tip form with a live "similar tips" panel
- [ ] Comment form under each tip; "ממתין לאישור" shown from this browser's own submissions
- [ ] Gate: `node tests/calc.test.js` + a headless browser run of submit → approve in sheet → visible

#### 6.3 Go-live
- [ ] Yair pastes the new `Code.gs` and deploys a new version (same URL)
- [ ] Live check: submit, approve, see it on the site, clean up the test rows
