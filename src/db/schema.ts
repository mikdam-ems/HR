import { relations } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/** "Manager" is not a role: anyone with direct reports is a manager. */
export const roleEnum = pgEnum('role', ['employee', 'hr', 'finance', 'admin']);
export type Role = (typeof roleEnum.enumValues)[number];

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
};

export const employees = pgTable(
  'employees',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Google account email, stored lower-case. This is how people sign in. */
    email: text('email').notNull(),
    nameEn: text('name_en').notNull(),
    nameAr: text('name_ar'),
    jobTitle: text('job_title'),
    managerId: uuid('manager_id').references((): AnyPgColumn => employees.id, { onDelete: 'set null' }),
    hireDate: date('hire_date', { mode: 'string' }),
    roles: roleEnum('roles').array().notNull().default(['employee']),
    active: boolean('active').notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex('employees_email_idx').on(t.email), index('employees_manager_idx').on(t.managerId)],
);

export const calendars = pgTable('calendars', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  /** Working weekdays, 0 = Sunday … 6 = Saturday. */
  workWeek: smallint('work_week').array().notNull(),
  ...timestamps,
});

export const holidays = pgTable(
  'holidays',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    calendarId: uuid('calendar_id')
      .notNull()
      .references(() => calendars.id, { onDelete: 'cascade' }),
    date: date('date', { mode: 'string' }).notNull(),
    nameEn: text('name_en').notNull(),
    nameAr: text('name_ar'),
  },
  (t) => [uniqueIndex('holidays_calendar_date_idx').on(t.calendarId, t.date)],
);

export const clients = pgTable('clients', {
  id: uuid('id').primaryKey().defaultRandom(),
  nameEn: text('name_en').notNull(),
  nameAr: text('name_ar'),
  calendarId: uuid('calendar_id')
    .notNull()
    .references(() => calendars.id, { onDelete: 'restrict' }),
  active: boolean('active').notNull().default(true),
  ...timestamps,
});

export const assignments = pgTable(
  'assignments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'restrict' }),
    startDate: date('start_date', { mode: 'string' }).notNull(),
    /** Inclusive. Null = open-ended. */
    endDate: date('end_date', { mode: 'string' }),
    primary: boolean('primary').notNull().default(true),
    ...timestamps,
  },
  (t) => [index('assignments_employee_idx').on(t.employeeId)],
);

export const schedules = pgTable(
  'schedules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    effectiveFrom: date('effective_from', { mode: 'string' }).notNull(),
    /** HH:MM */
    startTime: text('start_time').notNull(),
    /** HH:MM; at or before startTime means the shift runs past midnight. */
    endTime: text('end_time').notNull(),
    breakMinutes: integer('break_minutes').notNull().default(0),
    shiftCode: text('shift_code'),
    ...timestamps,
  },
  (t) => [uniqueIndex('schedules_employee_from_idx').on(t.employeeId, t.effectiveFrom)],
);

export const timesheetStatusEnum = pgEnum('timesheet_status', ['draft', 'submitted', 'returned', 'approved']);
export type TimesheetStatus = (typeof timesheetStatusEnum.enumValues)[number];

export const leaveTypeEnum = pgEnum('leave_type', [
  'annual',
  'sick',
  'maternity',
  'paternity',
  'bereavement',
  'hajj',
  'unpaid',
  'compensatory',
]);

/** One per person per month. Created on first edit or submit; a month with no row is an untouched draft. */
export const timesheets = pgTable(
  'timesheets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    year: integer('year').notNull(),
    month: integer('month').notNull(),
    status: timesheetStatusEnum('status').notNull().default('draft'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    decidedById: uuid('decided_by_id').references(() => employees.id, { onDelete: 'set null' }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    /** The manager's note when returning (or approving). */
    managerNote: text('manager_note'),
    /** Month totals frozen at submit and approval, so later calendar changes don't rewrite history. */
    totals: jsonb('totals'),
    ...timestamps,
  },
  (t) => [uniqueIndex('timesheets_employee_month_idx').on(t.employeeId, t.year, t.month)],
);

/** A day that differs from the auto-filled schedule. Days without a row are "as scheduled". */
export const dayEntries = pgTable(
  'day_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    date: date('date', { mode: 'string' }).notNull(),
    workedMinutes: integer('worked_minutes').notNull(),
    /** HH:MM, kept for display; workedMinutes is what counts. */
    startTime: text('start_time'),
    endTime: text('end_time'),
    leaveType: leaveTypeEnum('leave_type'),
    /** 1 = full day, 0.5 = half day. */
    leavePortion: numeric('leave_portion', { mode: 'number' }),
    note: text('note'),
    ...timestamps,
  },
  (t) => [uniqueIndex('day_entries_employee_date_idx').on(t.employeeId, t.date)],
);

export const leaveStatusEnum = pgEnum('leave_status', ['pending', 'approved', 'declined', 'cancelled']);
export type LeaveStatus = (typeof leaveStatusEnum.enumValues)[number];

export const leaveRequests = pgTable(
  'leave_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    type: leaveTypeEnum('type').notNull(),
    fromDate: date('from_date', { mode: 'string' }).notNull(),
    toDate: date('to_date', { mode: 'string' }).notNull(),
    halfDay: boolean('half_day').notNull().default(false),
    /** Working days the request uses, worked out when it was made (weekends and client holidays excluded). */
    daysUsed: numeric('days_used', { mode: 'number' }).notNull(),
    note: text('note'),
    status: leaveStatusEnum('status').notNull().default('pending'),
    decidedById: uuid('decided_by_id').references(() => employees.id, { onDelete: 'set null' }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    managerNote: text('manager_note'),
    ...timestamps,
  },
  (t) => [index('leave_requests_employee_idx').on(t.employeeId)],
);

/** HR corrections to a balance: carry-over from last year, opening balances, fixes. Positive or negative. */
export const leaveAdjustments = pgTable(
  'leave_adjustments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    year: integer('year').notNull(),
    type: leaveTypeEnum('type').notNull(),
    days: numeric('days', { mode: 'number' }).notNull(),
    reason: text('reason').notNull(),
    createdById: uuid('created_by_id').references(() => employees.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [index('leave_adjustments_employee_idx').on(t.employeeId, t.year)],
);

/** Small key/value settings: home calendar, overtime rates. */
export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  ...timestamps,
});

export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorId: uuid('actor_id').references(() => employees.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    entity: text('entity').notNull(),
    entityId: text('entity_id'),
    before: jsonb('before'),
    after: jsonb('after'),
    at: timestamp('at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('audit_entity_idx').on(t.entity, t.entityId)],
);

export const employeesRelations = relations(employees, ({ one, many }) => ({
  manager: one(employees, { fields: [employees.managerId], references: [employees.id], relationName: 'reports' }),
  reports: many(employees, { relationName: 'reports' }),
  assignments: many(assignments),
  schedules: many(schedules),
}));

export const calendarsRelations = relations(calendars, ({ many }) => ({
  holidays: many(holidays),
  clients: many(clients),
}));

export const holidaysRelations = relations(holidays, ({ one }) => ({
  calendar: one(calendars, { fields: [holidays.calendarId], references: [calendars.id] }),
}));

export const clientsRelations = relations(clients, ({ one, many }) => ({
  calendar: one(calendars, { fields: [clients.calendarId], references: [calendars.id] }),
  assignments: many(assignments),
}));

export const assignmentsRelations = relations(assignments, ({ one }) => ({
  employee: one(employees, { fields: [assignments.employeeId], references: [employees.id] }),
  client: one(clients, { fields: [assignments.clientId], references: [clients.id] }),
}));

export const schedulesRelations = relations(schedules, ({ one }) => ({
  employee: one(employees, { fields: [schedules.employeeId], references: [employees.id] }),
}));

export const timesheetsRelations = relations(timesheets, ({ one }) => ({
  employee: one(employees, { fields: [timesheets.employeeId], references: [employees.id] }),
  decidedBy: one(employees, { fields: [timesheets.decidedById], references: [employees.id] }),
}));

export const leaveRequestsRelations = relations(leaveRequests, ({ one }) => ({
  employee: one(employees, { fields: [leaveRequests.employeeId], references: [employees.id] }),
}));

export type Employee = typeof employees.$inferSelect;
export type LeaveRequestRow = typeof leaveRequests.$inferSelect;
export type LeaveAdjustmentRow = typeof leaveAdjustments.$inferSelect;
export type TimesheetRow = typeof timesheets.$inferSelect;
export type DayEntryRow = typeof dayEntries.$inferSelect;
export type Calendar = typeof calendars.$inferSelect;
export type HolidayRow = typeof holidays.$inferSelect;
export type ClientRow = typeof clients.$inferSelect;
export type AssignmentRow = typeof assignments.$inferSelect;
export type ScheduleRow = typeof schedules.$inferSelect;
