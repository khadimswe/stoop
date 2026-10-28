// What the day itself means for a store event: holidays and the days around them, paydays, tax
// refund season and the seasons that move foot traffic. Deterministic, from the date alone (no
// Qloo, no model), so the plan can fit the day and the trace can say why. Local game days are not
// known here; the manager can name one in the notes.

export interface DayContext {
  /** "Saturday, October 31, 2026" */
  label: string;
  /** Plain facts about the day, most relevant first. */
  notes: string[];
}

const utc = (date: string) => new Date(`${date}T12:00:00Z`);
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

/** The nth weekday (0 = Sunday) of a month, or the last one when n is -1. */
function nthWeekday(year: number, month: number, weekday: number, n: number): string {
  if (n === -1) {
    const last = new Date(Date.UTC(year, month + 1, 0, 12));
    return ymd(addDays(last, -((last.getUTCDay() - weekday + 7) % 7)));
  }
  const first = new Date(Date.UTC(year, month, 1, 12));
  return ymd(addDays(first, ((weekday - first.getUTCDay() + 7) % 7) + (n - 1) * 7));
}

/** US holidays and shopping days that change who is out on a sidewalk. No identity or heritage observances. */
export function holidays(year: number): { date: string; name: string }[] {
  const thanksgiving = nthWeekday(year, 10, 4, 4);
  return [
    { date: `${year}-01-01`, name: "New Year's Day" },
    { date: `${year}-02-14`, name: "Valentine's Day" },
    { date: nthWeekday(year, 4, 0, 2), name: "Mother's Day" },
    { date: nthWeekday(year, 4, 1, -1), name: "Memorial Day" },
    { date: nthWeekday(year, 5, 0, 3), name: "Father's Day" },
    { date: `${year}-07-04`, name: "the Fourth of July" },
    { date: nthWeekday(year, 8, 1, 1), name: "Labor Day" },
    { date: `${year}-10-31`, name: "Halloween" },
    { date: `${year}-11-11`, name: "Veterans Day" },
    { date: thanksgiving, name: "Thanksgiving" },
    { date: ymd(addDays(utc(thanksgiving), 1)), name: "Black Friday" },
    { date: ymd(addDays(utc(thanksgiving), 2)), name: "Small Business Saturday" },
    { date: `${year}-12-24`, name: "Christmas Eve" },
    { date: `${year}-12-25`, name: "Christmas" },
    { date: `${year}-12-31`, name: "New Year's Eve" },
  ];
}

const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function dayContext(date: string): DayContext {
  const day = utc(date);
  const year = day.getUTCFullYear();
  const month = day.getUTCMonth() + 1;
  const dom = day.getUTCDate();
  const label = day.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
  const notes: string[] = [];

  for (const h of [...holidays(year), ...holidays(year + 1)]) {
    const diff = Math.round((utc(h.date).getTime() - day.getTime()) / 86_400_000);
    if (diff === 0) notes.push(`It is ${h.name}.`);
    else if (diff > 0 && diff <= 7) notes.push(`${h.name} is ${diff === 1 ? "tomorrow" : `in ${diff} days`} (${WEEKDAY[utc(h.date).getUTCDay()]}).`);
    else if (diff < 0 && diff >= -2) notes.push(`${h.name} was ${diff === -1 ? "yesterday" : "two days ago"}.`);
  }

  if (dom <= 3) notes.push("It is the start of the month, when many people have just been paid and bills come due.");
  else if (dom >= 14 && dom <= 17) notes.push("It is mid-month, around a common payday.");
  const weekday = day.getUTCDay();
  if (weekday === 5) notes.push("It is a Friday, a common payday.");
  if (weekday === 6 && (dom <= 3 || (dom >= 15 && dom <= 17))) notes.push("It is the weekend right after a common payday.");

  if ((month === 2) || (month === 3) || (month === 4 && dom <= 15)) notes.push("It is tax refund season, when many people shop for a new phone.");
  if ((month === 7 && dom >= 20) || month === 8) notes.push("It is back-to-school shopping season for adults buying for their households (nothing aimed at minors).");
  if (month === 11 && dom >= 20) notes.push("The holiday shopping season is starting.");
  if (month === 12 && dom <= 24) notes.push("It is the holiday shopping season.");
  if (weekday === 6 && month >= 9 && month <= 11) notes.push("It is a fall Saturday: college football is on, and game-day crowds can shift foot traffic.");
  if (weekday === 0 && (month >= 9 || month === 1)) notes.push("It is a fall or winter Sunday: pro football is on in the afternoon.");
  if (month === 12 || month <= 2) notes.push("It is winter: plan for the cold.");
  else if (month >= 6 && month <= 8) notes.push("It is summer: plan for heat and shade.");
  return { label, notes };
}
