const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const PREV_DAY = {
  sun: 'sat',
  mon: 'sun',
  tue: 'mon',
  wed: 'tue',
  thu: 'wed',
  fri: 'thu',
  sat: 'fri',
};

function parseHm(value) {
  if (typeof value !== 'string') return null;
  const m = /^(\d{2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

function getZonedDayAndMinutes(date, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = fmt.formatToParts(date);
  let weekday = '';
  let hour = 0;
  let minute = 0;
  for (const p of parts) {
    if (p.type === 'weekday') weekday = p.value.toLowerCase().slice(0, 3);
    if (p.type === 'hour') hour = Number(p.value) % 24;
    if (p.type === 'minute') minute = Number(p.value);
  }
  return { weekday, minutes: hour * 60 + minute };
}

/**
 * Evaluate a screen's `power` configuration at `now`.
 * Returns `'on'`, `'off'`, or `null` when power management is disabled or unscheduled.
 */
export function evaluateSchedule(power, now = new Date()) {
  if (!power || typeof power !== 'object') return null;
  if (!power.driver || power.driver === 'none') return null;

  if (power.override === 'on') return 'on';
  if (power.override === 'off') return 'off';

  const schedule = power.schedule;
  if (!schedule || !Array.isArray(schedule.windows) || schedule.windows.length === 0) {
    return null;
  }

  const date = now instanceof Date ? now : new Date(now);
  const tz = schedule.timezone || 'UTC';
  const { weekday, minutes } = getZonedDayAndMinutes(date, tz);
  if (!WEEKDAYS.includes(weekday)) return null;
  const prevWeekday = PREV_DAY[weekday];

  for (const win of schedule.windows) {
    if (!win || typeof win !== 'object') continue;
    const days = new Set(Array.isArray(win.days) ? win.days.map((d) => String(d).toLowerCase()) : []);
    if (days.size === 0) continue;

    const startMin = parseHm(win.start);
    const endMin = parseHm(win.end);
    if (startMin === null || endMin === null) continue;

    if (startMin < endMin) {
      if (days.has(weekday) && minutes >= startMin && minutes < endMin) {
        return 'on';
      }
    } else if (endMin < startMin) {
      if ((days.has(weekday) && minutes >= startMin) || (days.has(prevWeekday) && minutes < endMin)) {
        return 'on';
      }
    }
  }

  return 'off';
}
