# מחשבון קמפינג אכזיב

A static RTL page that helps families in a group camping trip work out what their stay at the Achziv night camp (northern camp) will cost.

- **Calculator:** family composition (adults 14+, children 5–13, under-5s), optional discounts (Matmon, reserve duty, soldiers, students, seniors, disabled), mattress rental, and stay dates (default 06/10–10/10/2026). The stay can be split into several periods, each with its own composition.
- **Result:** the full price, plus the price if the group reaches 30+ people. The group rate applies to regular payers only, because discounts don't stack.
- **Registration (optional):** a family saves its entry under a name and a 4–8 digit PIN, and can come back to load, update or cancel it. The site shows how many people are registered for each night, and whether each night reaches the 30 needed for the group price. The data lives in a Google Sheet; see `backend/SETUP.md`.
- **Price list** and **place info** (northern-camp facilities, accessibility, hours, rules) tabs.

Prices come from the official [parks.org.il page](https://www.parks.org.il/camping/%D7%97%D7%A0%D7%99%D7%95%D7%9F-%D7%9C%D7%99%D7%9C%D7%94-%D7%92%D7%9F-%D7%9C%D7%90%D7%95%D7%9E%D7%99-%D7%90%D7%9B%D7%96%D7%99%D7%91-%D7%95%D7%97%D7%95%D7%A3-%D7%90%D7%9B%D7%96%D7%99%D7%91/) and were checked on 30/09/2026. To update them, edit only `prices.js`.

No build step. Open `index.html`, or host it on GitHub Pages (Settings → Pages → deploy from `main`, root).

Tests: `node tests/calc.test.js` and `node tests/backend.test.js`
