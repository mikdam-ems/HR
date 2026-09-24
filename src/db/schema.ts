import { relations } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  date,
  index,
  integer,
  jsonb,
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

export type Employee = typeof employees.$inferSelect;
export type Calendar = typeof calendars.$inferSelect;
export type HolidayRow = typeof holidays.$inferSelect;
export type ClientRow = typeof clients.$inferSelect;
export type AssignmentRow = typeof assignments.$inferSelect;
export type ScheduleRow = typeof schedules.$inferSelect;
