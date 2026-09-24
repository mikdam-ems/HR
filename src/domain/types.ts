/** A calendar date with no time zone, written as YYYY-MM-DD. */
export type ISODate = string;

/** Day of the week, 0 = Sunday … 6 = Saturday. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface Holiday {
  date: ISODate;
  name: string;
  nameAr?: string;
}

/** A set of working weekdays plus public holidays: a client's, or EMS's home calendar (Jordan). */
export interface WorkCalendar {
  id: string;
  name: string;
  workWeek: readonly Weekday[];
  holidays: readonly Holiday[];
}

/** A company EMS works for. EMS itself can be a client (e.g. "EMS Internal") for people between projects. */
export interface Client {
  id: string;
  name: string;
  nameAr?: string;
  calendarId: string;
}

/** An employee working for a client between two dates. `end` is inclusive; null means open-ended. */
export interface Assignment {
  employeeId: string;
  clientId: string;
  start: ISODate;
  end: ISODate | null;
  /** When someone has several assignments at once, the primary one sets their work week and hours. */
  primary: boolean;
}

/** A person's normal hours from a given date until the next schedule starts. Times are HH:MM. */
export interface Schedule {
  employeeId: string;
  effectiveFrom: ISODate;
  start: string;
  end: string;
  /** Unpaid break inside the window, if any. Defaults to 0. */
  breakMinutes?: number;
  /** Optional label such as "A", "B" or "C" when the schedule is a named shift. */
  shiftCode?: string;
}

/**
 * How the system classifies a day for one person. Rules are applied in this order:
 * 1. client_holiday   – any assigned client has a public holiday (day off, no leave used)
 * 2. weekend          – not a working day in the primary client's work week
 * 3. special_overtime – client working day that is a public holiday in the home calendar (Jordan)
 * 4. working          – a normal working day
 * `unassigned` means the person has no active assignment on that date (HR needs to fix it).
 */
export type DayType = 'working' | 'weekend' | 'client_holiday' | 'special_overtime' | 'unassigned';

export interface ResolvedDay {
  date: ISODate;
  employeeId: string;
  dayType: DayType;
  /** Name of the holiday that decided the day type, if any. */
  holidayName?: string;
  holidayNameAr?: string;
  clientIds: string[];
  primaryClientId: string | null;
  /** Minutes the person is expected to work. 0 on days off. */
  expectedMinutes: number;
  schedule: Schedule | null;
}

/** Everything the rules need to know. Loaded from the database in the app; built by hand in tests. */
export interface RulesContext {
  clients: Record<string, Client>;
  calendars: Record<string, WorkCalendar>;
  /** EMS's own calendar (Jordan). Only its holidays are used, to detect special overtime. */
  homeCalendar: WorkCalendar;
  assignments: readonly Assignment[];
  schedules: readonly Schedule[];
}

export type LeaveType =
  | 'annual'
  | 'sick'
  | 'maternity'
  | 'paternity'
  | 'bereavement'
  | 'hajj'
  | 'unpaid'
  | 'compensatory';

/** What the employee recorded for a day. A missing entry means "as scheduled". */
export interface DayEntry {
  date: ISODate;
  workedMinutes: number;
  leave?: { type: LeaveType; portion: 1 | 0.5 };
}

/** Multipliers per overtime type. Set by Admin; special is 1.2 today. */
export interface OvertimeRates {
  /** Hours beyond the schedule on a working day. */
  regular: number;
  /** Any hours on a Jordanian holiday while the client is working. */
  special: number;
  /** Any hours on a client weekend or client holiday. */
  offDay: number;
}
