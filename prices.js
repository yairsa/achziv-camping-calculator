// Price data — copied from the official parks.org.il page for the Achziv night camp.
// Source: https://www.parks.org.il/camping/חניון-לילה-גן-לאומי-אכזיב-וחוף-אכזיב/
// Checked 30/09/2026. When the park changes prices, edit only this file.

window.CAMP = {
  checked: '30/09/2026',
  sourceUrl: 'https://www.parks.org.il/camping/%D7%97%D7%A0%D7%99%D7%95%D7%9F-%D7%9C%D7%99%D7%9C%D7%94-%D7%92%D7%9F-%D7%9C%D7%90%D7%95%D7%9E%D7%99-%D7%90%D7%9B%D7%96%D7%99%D7%91-%D7%95%D7%97%D7%95%D7%A3-%D7%90%D7%9B%D7%96%D7%99%D7%91/',

  // Stay defaults (ISO dates; displayed day-first).
  defaultFrom: '2026-10-06',
  defaultTo: '2026-10-10',
  dateRangeStart: '2026-10-01',
  dateRangeEnd: '2026-10-20',
  maxConsecutiveNights: 6,
  groupMinPeople: 30,

  // Price per person per night, tent camping (לינת שטח באוהלים פרטיים).
  // groupPrice: official "קבוצה" rate (≈15% off) — applies to regular payers only.
  // main: shown in the basic family composition; the rest sit under "discounts".
  categories: [
    { id: 'adult',   label: 'מבוגר',              ages: 'גיל 14 ומעלה', price: 76, groupPrice: 65, main: true },
    { id: 'child',   label: 'ילד',                ages: 'גיל 5 עד 13',  price: 58, groupPrice: 49, main: true },
    { id: 'toddler', label: 'פעוט',               ages: 'עד גיל 5',     price: 0,  main: true,
      note: 'ללא תשלום — המחירון גובה מגיל 5' },

    { id: 'matmonAdult',  label: 'מנוי מטמון — מבוגר', ages: 'גיל 14 ומעלה', price: 57,
      note: 'בהצגת כרטיס מנוי בתוקף, לפי ההרכב שעל הכרטיס' },
    { id: 'matmonChild',  label: 'מנוי מטמון — ילד',   ages: 'גיל 5 עד 13',  price: 44,
      note: 'בהצגת כרטיס מנוי בתוקף, לפי ההרכב שעל הכרטיס' },
    { id: 'reserveAdult', label: 'משרת מילואים פעיל ומשפחתו — מבוגר', ages: 'גיל 14 ומעלה', price: 65,
      note: 'לבעל הכרטיס ולבני משפחתו, בהצגת כרטיס מילואים פעיל' },
    { id: 'reserveChild', label: 'משרת מילואים פעיל ומשפחתו — ילד',   ages: 'גיל 5 עד 13',  price: 49,
      note: 'לבעל הכרטיס ולבני משפחתו, בהצגת כרטיס מילואים פעיל' },
    { id: 'soldier', label: 'חייל/ת בשירות חובה / שירות לאומי', price: 58, note: 'בהצגת חוגר / כרטיס שירות לאומי' },
    { id: 'student', label: 'סטודנט/ית',          price: 65, note: 'בהצגת כרטיס בתוקף' },
    { id: 'senior',  label: 'אזרח/ית ותיק/ה',     price: 38, note: 'בהצגת תעודה' },
    { id: 'idfDisabled', label: 'נכה צה"ל ומלווה', price: 38, note: 'בהצגת תעודה' },
    { id: 'escort',  label: 'מלווה לאדם עם מוגבלות', price: 0,
      note: 'פטור למלווה בלבד — בעל התעודה משלם מחיר מלא' }
  ],

  // Per-night extras (not people — never counted toward the group size).
  extras: [
    { id: 'mattress', label: 'השכרת מזרן', unit: 'ללילה', price: 12,
      note: 'לפי המלאי בחניון, ללא התחייבות. חלוקה בשער 15:00–20:00, החזרה 08:00–11:00' }
  ]
};
