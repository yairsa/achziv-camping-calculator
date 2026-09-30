// Guided tour texts: every bubble's title and text — shared by the site and the backend (docs/tour-plan.md §5).
// The site loads it with a <script> tag, so a tour shows its text at once, even before the server answers.
// backend/build.py inlines it into Code.gs at `//@include tour-texts.js`, and the script writes these rows into
// the sheet's הדרכה tab the first time it creates the tab. After that Yair edits כותרת and טקסט there; a cell left
// empty falls back to the text here. `key` ties a row to its step in tour.js (where the arrow points stays code).
//
// Text format: plain text. A blank line starts a new paragraph, **...** is bold. No HTML: tour.js escapes it.

// The name each tour carries in the sheet's סיור column.
var TOUR_NAMES_ = { welcome: 'פתיחה', gear: 'ציוד', acts: 'פעילויות', tips: 'טיפים' };

var TOUR_TEXTS_ = [
  { tour: 'welcome', key: 'hello', title: 'ברוכים הבאים!',
    text: 'האתר עוזר לקבוצה להתארגן לקמפינג באכזיב: חישוב עלות הלינה, מידע על המקום, ' +
      'רשימת ציוד, פעילויות וטיפים. סיור קצר, פחות מדקה.\n\n' +
      '**לידיעתכם:** זה אתר לא רשמי ומייעץ בלבד, שבנה אחד מחברי הקבוצה בשביל הקבוצה. ' +
      'הוא לא קשור לרשות הטבע והגנים או לחניון, ולא מתחייב לדבר. המחיר הקובע הוא המחיר בקופה. ט.ל.ח. ' +
      'השתמשו בו אם הוא עוזר לכם.\n\n' +
      '**פרטיות:** לא נאספים פרטים אישיים (לא טלפון, לא מייל ולא תעודת זהות). רשימת הציוד נשמרת רק ' +
      'בדפדפן שלכם. הרשמה שומרת רק את השם שבחרתם, מספר הלנים והתאריכים, כדי לספור כמה נהיה.' },
  { tour: 'welcome', key: 'help', title: 'הסיור תמיד כאן',
    text: 'אפשר לחזור לסיור הזה בכל זמן, בכפתור ?. בכל חלק של האתר הוא מציג סיור קצר על אותו חלק.' },
  { tour: 'welcome', key: 'tabs', title: 'חלקי האתר',
    text: 'כאן עוברים בין החלקים: המחשבון, מידע על המקום, רשימת ציוד, פעילויות וטיפים מהקבוצה.' },
  { tour: 'welcome', key: 'prices', title: 'מחירון',
    text: 'המחירון המלא, מאתר רשות הטבע והגנים.' },
  { tour: 'welcome', key: 'who', title: '1. מי מגיע?',
    text: 'סמנו כמה מבוגרים וילדים מגיעים. יש לכם הנחה (סטודנטים, מילואים, אזרחים ותיקים ועוד)? פתחו את "יש לכם הנחה" וספרו אותם שם.' },
  { tour: 'welcome', key: 'when', title: '2. מתי?',
    text: 'בוחרים תאריך הגעה ותאריך עזיבה. מגיעים רק לחלק מהזמן, או בהפסקות? "הוספת תקופה" מפצלת את השהייה.' },
  { tour: 'welcome', key: 'cost', title: '3. כמה זה עולה',
    text: 'העלות מתעדכנת מיד בזמן שממלאים: מחיר רגיל ומחיר עם הנחה קבוצתית.' },
  { tour: 'welcome', key: 'register', title: '4. שמירת ההרשמה (לא חובה)',
    text: 'רוצים שהקבוצה תדע שאתם מגיעים? שמרו את מה שמילאתם, עם שם משפחה וקוד שתבחרו. עם אותו שם וקוד אפשר לעדכן, לבטל ולהצטרף לפעילויות.' },
  { tour: 'welcome', key: 'share', title: 'שיתוף עם חברים',
    text: 'מכירים עוד משפחות מהקבוצה? שלחו להן את האתר.' },

  { tour: 'gear', key: 'views', title: 'רשימת ציוד',
    text: '"בחירת פריטים" מציגה את כל מה שכדאי להביא. "הרשימה שלי" מציגה את מה שבחרתם.' },
  { tour: 'gear', key: 'search', title: 'חיפוש וסינון',
    text: 'מחפשים פריט, או מסננים לפי תגית.' },
  { tour: 'gear', key: 'basic', title: 'הפריטים הבסיסיים',
    text: 'לחיצה אחת מוסיפה לרשימה שלכם את כל הפריטים הבסיסיים.' },
  { tour: 'gear', key: 'pack', title: 'אורזים',
    text: 'ב"הרשימה שלי" מסמנים מה כבר ארוז ורואים כמה נשאר. משם אפשר גם לשלוח את הרשימה בוואטסאפ. הרשימה נשמרת רק בדפדפן הזה.' },
  { tour: 'gear', key: 'add', title: 'חסר פריט?',
    text: 'הוסיפו אותו לרשימה שלכם. הוא יישלח גם למארגן, שיחליט אם להוסיף אותו לרשימה הכללית.' },

  { tour: 'acts', key: 'views', title: 'פעילויות',
    text: 'פעילויות שמשפחות בקבוצה מתכננות. רואים אותן ברשימה לפי ימים, או בלוח שבועי.' },
  { tour: 'acts', key: 'search', title: 'חיפוש וסינון',
    text: 'חיפוש, וסינון לפי יום ולפי קהל: לכולם, למבוגרים או לילדים.' },
  { tour: 'acts', key: 'details', title: 'פרטים והצטרפות',
    text: 'לחיצה על פעילות פותחת את הפרטים. משם מצטרפים, עם השם והקוד של ההרשמה.' },
  { tour: 'acts', key: 'add', title: 'הוספת פעילות',
    text: 'משפחה רשומה יכולה להוסיף פעילות משלה.' },

  { tour: 'tips', key: 'intro', title: 'טיפים מהקבוצה',
    text: 'טיפים שחברי הקבוצה כתבו: ציוד, לינה, אוכל, ילדים ועוד.' },
  { tour: 'tips', key: 'search', title: 'חיפוש',
    text: 'חיפוש בטיפים, וסינון לפי קטגוריה.' },
  { tour: 'tips', key: 'write', title: 'כתיבת טיפ',
    text: 'יש לכם טיפ? כתבו אותו כאן. הוא יופיע באתר אחרי אישור של המארגן.' }
];
