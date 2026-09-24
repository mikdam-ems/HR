import type { Assignment, OvertimeRates, RulesContext, Schedule, WorkCalendar } from '../types';

// Holiday dates here are test data, not an official holiday list.
export const saudiCalendar: WorkCalendar = {
  id: 'cal-sa',
  name: 'Saudi Arabia (Sun–Thu)',
  workWeek: [0, 1, 2, 3, 4],
  holidays: [
    { date: '2026-09-23', name: 'Saudi National Day' },
    { date: '2026-06-01', name: 'Shared test holiday' },
  ],
};

/** A client that also works Saturdays. */
export const saturdayCalendar: WorkCalendar = {
  id: 'cal-sat',
  name: 'Client B (Sun–Thu + Sat)',
  workWeek: [0, 1, 2, 3, 4, 6],
  holidays: [{ date: '2026-09-15', name: 'Client B company day' }],
};

export const jordanCalendar: WorkCalendar = {
  id: 'cal-jo',
  name: 'Jordan (EMS home)',
  workWeek: [0, 1, 2, 3, 4],
  holidays: [
    { date: '2026-05-25', name: 'Independence Day' },
    { date: '2026-08-26', name: "Prophet's Birthday (test date)" },
    { date: '2026-05-29', name: 'Test holiday on a Friday' },
    { date: '2026-06-01', name: 'Shared test holiday' },
  ],
};

const std = (employeeId: string, effectiveFrom = '2026-01-01'): Schedule => ({
  employeeId,
  effectiveFrom,
  start: '09:00',
  end: '17:00',
});

export const assignments: Assignment[] = [
  // Lina: Jadwa all year; also Client B for September only.
  { employeeId: 'lina', clientId: 'jadwa', start: '2026-01-01', end: null, primary: true },
  { employeeId: 'lina', clientId: 'clientB', start: '2026-09-01', end: '2026-09-30', primary: false },
  // Omar: Jadwa.
  { employeeId: 'omar', clientId: 'jadwa', start: '2026-01-01', end: null, primary: true },
  // Sami: Client B until 30 June, then moves to Jadwa.
  { employeeId: 'sami', clientId: 'clientB', start: '2026-01-01', end: '2026-06-30', primary: true },
  { employeeId: 'sami', clientId: 'jadwa', start: '2026-07-01', end: null, primary: true },
  // Hala: Client B only (works Saturdays).
  { employeeId: 'hala', clientId: 'clientB', start: '2026-01-01', end: null, primary: true },
];

export const schedules: Schedule[] = [
  std('lina'),
  std('omar'),
  std('sami'),
  std('hala'),
  // Omar moves to 12:00–21:00 from October, then night shift C from November.
  { employeeId: 'omar', effectiveFrom: '2026-10-01', start: '12:00', end: '21:00' },
  { employeeId: 'omar', effectiveFrom: '2026-11-01', start: '22:00', end: '06:00', shiftCode: 'C' },
];

export const ctx: RulesContext = {
  clients: {
    jadwa: { id: 'jadwa', name: 'Jadwa Investment', calendarId: 'cal-sa' },
    clientB: { id: 'clientB', name: 'Client B', calendarId: 'cal-sat' },
  },
  calendars: { 'cal-sa': saudiCalendar, 'cal-sat': saturdayCalendar },
  homeCalendar: jordanCalendar,
  assignments,
  schedules,
};

/** Only special (1.2) is decided today; the other rates are placeholders until HR confirms. */
export const rates: OvertimeRates = { regular: 1, special: 1.2, offDay: 1 };
