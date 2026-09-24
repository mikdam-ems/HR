import type { DB } from '@/db';
import { assignments, calendars, clients, holidays, schedules } from '@/db/schema';
import type { RulesContext, Weekday, WorkCalendar } from '@/domain';
import { getSettings } from './settings';

const EMPTY_HOME: WorkCalendar = { id: 'none', name: 'No home calendar set', workWeek: [0, 1, 2, 3, 4], holidays: [] };

/**
 * Loads everything the rules engine needs from the database. At EMS's size (tens of people,
 * a handful of clients) loading it all is cheaper and simpler than filtering.
 */
export async function loadRulesContext(db: DB): Promise<RulesContext> {
  const [calRows, holidayRows, clientRows, assignmentRows, scheduleRows, appSettings] = await Promise.all([
    db.select().from(calendars),
    db.select().from(holidays),
    db.select().from(clients),
    db.select().from(assignments),
    db.select().from(schedules),
    getSettings(db),
  ]);

  const cals: Record<string, WorkCalendar> = {};
  for (const c of calRows) {
    cals[c.id] = {
      id: c.id,
      name: c.name,
      workWeek: c.workWeek as Weekday[],
      holidays: holidayRows.filter((h) => h.calendarId === c.id).map((h) => ({ date: h.date, name: h.nameEn, nameAr: h.nameAr ?? undefined })),
    };
  }

  return {
    calendars: cals,
    homeCalendar: (appSettings.homeCalendarId && cals[appSettings.homeCalendarId]) || EMPTY_HOME,
    clients: Object.fromEntries(clientRows.map((c) => [c.id, { id: c.id, name: c.nameEn, nameAr: c.nameAr ?? undefined, calendarId: c.calendarId }])),
    assignments: assignmentRows.map((a) => ({
      employeeId: a.employeeId,
      clientId: a.clientId,
      start: a.startDate,
      end: a.endDate,
      primary: a.primary,
    })),
    schedules: scheduleRows.map((s) => ({
      employeeId: s.employeeId,
      effectiveFrom: s.effectiveFrom,
      start: s.startTime,
      end: s.endTime,
      breakMinutes: s.breakMinutes,
      shiftCode: s.shiftCode ?? undefined,
    })),
  };
}
