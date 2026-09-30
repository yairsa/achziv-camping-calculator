// The example activities — shared by the site and the backend (docs/activities-plan.md §5.2b).
// The backend adds them to the sheet from the menu "הוספת 3 פעילויות לדוגמה" (backend/build.py inlines this file
// into Code.gs at `//@include acts-demo.js`). The site shows them, unsaved, on the preview link ?demo#acts.
var DEMO_OWNER = 'המארגנים';
var DEMO_NOTE = '\n\nזו פעילות לדוגמה, כדי להראות איך זה נראה.';
var DEMO_ACTS = [
  { clientId: 'demo-activity-1', topic: 'ארוחת ערב משותפת ומנגל', start: '2026-10-07T18:30', end: '2026-10-07T21:00', tag: 'לכולם',
    capacity: '', description: 'מדליקים מנגלים ליד השולחנות, וכל משפחה מביאה משהו לשולחן המשותף.',
    required: 'צלחת, כוס וסכו"ם', suggested: 'סלט או קינוח לשולחן המשותף' },
  { clientId: 'demo-activity-2', topic: 'יוגה בזריחה על החוף', start: '2026-10-08T06:00', end: '2026-10-08T07:00', tag: 'מבוגרים',
    capacity: 12, description: 'תרגול רגוע לכל הרמות, מול הים.', required: 'מזרן יוגה או מגבת', suggested: 'בקבוק מים' },
  { clientId: 'demo-activity-3', topic: 'חיפוש אוצרות בחוף', start: '2026-10-09T10:00', end: '2026-10-09T11:30', tag: 'ילדים',
    ageFrom: 5, ageTo: 10, capacity: 15, description: 'משימות ורמזים לאורך החוף, ופרס קטן בסוף.',
    required: 'כובע ובקבוק מים', suggested: 'דלי קטן' }
];
