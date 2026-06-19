export type InterestFrequency = "daily" | "weekly" | "monthly" | "yearly";

export interface InterestScheduleAnchor {
  timezoneOffsetMinutes: number;
  dayOfMonth: number;
  month: number;
}

const MINUTES_TO_MS = 60 * 1000;

function daysInUtcMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

export function createInterestScheduleAnchor(date: Date): InterestScheduleAnchor {
  return {
    timezoneOffsetMinutes: date.getTimezoneOffset(),
    dayOfMonth: date.getDate(),
    month: date.getMonth()
  };
}

export function normalizeInterestScheduleAnchor(
  value: Partial<InterestScheduleAnchor> | null | undefined,
  date: Date
): InterestScheduleAnchor {
  const rawOffset = Number(value?.timezoneOffsetMinutes);
  const timezoneOffsetMinutes = Number.isFinite(rawOffset) && rawOffset >= -840 && rawOffset <= 840
    ? rawOffset
    : 0;
  const wallClock = new Date(date.getTime() - timezoneOffsetMinutes * MINUTES_TO_MS);
  const rawDay = Number(value?.dayOfMonth);
  const rawMonth = Number(value?.month);

  return {
    timezoneOffsetMinutes,
    dayOfMonth: Number.isInteger(rawDay) && rawDay >= 1 && rawDay <= 31
      ? rawDay
      : wallClock.getUTCDate(),
    month: Number.isInteger(rawMonth) && rawMonth >= 0 && rawMonth <= 11
      ? rawMonth
      : wallClock.getUTCMonth()
  };
}

export function addInterestPeriods(
  start: Date,
  frequency: InterestFrequency,
  periods: number,
  anchorValue?: Partial<InterestScheduleAnchor> | null
) {
  if (!Number.isInteger(periods) || periods < 0) {
    throw new Error("计息周期数无效");
  }
  if (periods === 0) return new Date(start);

  const anchor = normalizeInterestScheduleAnchor(anchorValue, start);
  const wallClock = new Date(start.getTime() - anchor.timezoneOffsetMinutes * MINUTES_TO_MS);
  const hour = wallClock.getUTCHours();
  const minute = wallClock.getUTCMinutes();
  const second = wallClock.getUTCSeconds();
  const millisecond = wallClock.getUTCMilliseconds();
  let year = wallClock.getUTCFullYear();
  let month = wallClock.getUTCMonth();
  let day = wallClock.getUTCDate();

  if (frequency === "daily" || frequency === "weekly") {
    day += periods * (frequency === "weekly" ? 7 : 1);
    const advanced = new Date(Date.UTC(year, month, day, hour, minute, second, millisecond));
    return new Date(advanced.getTime() + anchor.timezoneOffsetMinutes * MINUTES_TO_MS);
  }

  if (frequency === "monthly") {
    const totalMonths = year * 12 + month + periods;
    year = Math.floor(totalMonths / 12);
    month = totalMonths % 12;
    day = Math.min(anchor.dayOfMonth, daysInUtcMonth(year, month));
  } else {
    year += periods;
    month = anchor.month;
    day = Math.min(anchor.dayOfMonth, daysInUtcMonth(year, month));
  }

  const advanced = new Date(Date.UTC(year, month, day, hour, minute, second, millisecond));
  return new Date(advanced.getTime() + anchor.timezoneOffsetMinutes * MINUTES_TO_MS);
}

export function getDueInterestSchedule(
  firstDueAt: Date,
  now: Date,
  frequency: InterestFrequency,
  anchorValue?: Partial<InterestScheduleAnchor> | null
) {
  if (now.getTime() < firstDueAt.getTime()) return null;

  let lastDueOffset = 0;
  let upperBound = 1;
  while (addInterestPeriods(firstDueAt, frequency, upperBound, anchorValue).getTime() <= now.getTime()) {
    lastDueOffset = upperBound;
    upperBound *= 2;
    if (upperBound > 1_048_576) {
      throw new Error("待补算的计息周期过多");
    }
  }

  while (lastDueOffset + 1 < upperBound) {
    const midpoint = Math.floor((lastDueOffset + upperBound) / 2);
    if (addInterestPeriods(firstDueAt, frequency, midpoint, anchorValue).getTime() <= now.getTime()) {
      lastDueOffset = midpoint;
    } else {
      upperBound = midpoint;
    }
  }

  return {
    periods: lastDueOffset + 1,
    lastDueAt: addInterestPeriods(firstDueAt, frequency, lastDueOffset, anchorValue),
    nextDueAt: addInterestPeriods(firstDueAt, frequency, lastDueOffset + 1, anchorValue)
  };
}
