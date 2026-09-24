import { z } from 'zod';
import { roleEnum } from '@/db/schema';
import { toMinutes, toUtcMs } from '@/domain';

export type ErrorCode =
  | 'invalid_input'
  | 'not_found'
  | 'email_taken'
  | 'manager_loop'
  | 'end_before_start'
  | 'primary_overlap'
  | 'duplicate_assignment'
  | 'unknown_client'
  | 'unknown_calendar'
  | 'calendar_in_use'
  | 'month_not_started'
  | 'month_locked'
  | 'cross_year'
  | 'no_working_days'
  | 'leave_overlap'
  | 'insufficient_balance'
  | 'forbidden';

export type Result<T = void> = { ok: true; value: T } | { ok: false; error: ErrorCode; detail?: string };

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const fail = (error: ErrorCode, detail?: string): Result<never> => ({ ok: false, error, detail });

const isValidDate = (s: string) => {
  try {
    toUtcMs(s);
    return true;
  } catch {
    return false;
  }
};
const isValidTime = (s: string) => {
  try {
    toMinutes(s);
    return true;
  } catch {
    return false;
  }
};

export const isoDate = z.string().trim().refine(isValidDate, 'Expected a date as YYYY-MM-DD');
export const hhmm = z.string().trim().refine(isValidTime, 'Expected a time as HH:MM');
const optionalText = z
  .string()
  .trim()
  .nullish()
  .transform((v) => (v ? v : null));

export const employeeInput = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  nameEn: z.string().trim().min(1),
  nameAr: optionalText,
  jobTitle: optionalText,
  managerId: z.string().uuid().nullish().transform((v) => v ?? null),
  hireDate: isoDate.nullish().transform((v) => v ?? null),
  // Everyone is an employee; extra roles are added on top.
  roles: z
    .array(z.enum(roleEnum.enumValues))
    .default([])
    .transform((r) => Array.from(new Set(['employee' as const, ...r]))),
  active: z.boolean().default(true),
});
export type EmployeeInput = z.input<typeof employeeInput>;

export const assignmentInput = z.object({
  employeeId: z.string().uuid(),
  clientId: z.string().uuid(),
  startDate: isoDate,
  endDate: isoDate.nullish().transform((v) => v ?? null),
  primary: z.boolean().default(true),
});
export type AssignmentInput = z.input<typeof assignmentInput>;

export const scheduleInput = z.object({
  employeeId: z.string().uuid(),
  effectiveFrom: isoDate,
  startTime: hhmm,
  endTime: hhmm,
  breakMinutes: z.coerce.number().int().min(0).max(240).default(0),
  shiftCode: optionalText,
});
export type ScheduleInput = z.input<typeof scheduleInput>;

export const workWeek = z.array(z.coerce.number().int().min(0).max(6)).min(1);

export const calendarInput = z.object({
  name: z.string().trim().min(1),
  workWeek,
});

export const holidayInput = z.object({
  calendarId: z.string().uuid(),
  date: isoDate,
  nameEn: z.string().trim().min(1),
  nameAr: optionalText,
});

export const clientInput = z.object({
  nameEn: z.string().trim().min(1),
  nameAr: optionalText,
  calendarId: z.string().uuid(),
  active: z.boolean().default(true),
});

/** Parses with a schema and turns failure into an `invalid_input` result. */
export function parse<S extends z.ZodType>(schema: S, input: unknown): Result<z.output<S>> {
  const r = schema.safeParse(input);
  if (r.success) return ok(r.data);
  const issue = r.error.issues[0];
  return fail('invalid_input', issue ? `${issue.path.join('.')}: ${issue.message}` : undefined);
}
