import type { Role } from '@/db/schema';

export interface CurrentUser {
  id: string;
  email: string;
  nameEn: string;
  nameAr: string | null;
  roles: Role[];
  /** True when at least one active employee reports to this person. */
  isManager: boolean;
  /** Bumps when the photo changes; absent = no photo. */
  photoVersion?: number | null;
  status?: { emoji: string; text: string | null } | null;
  /** Managers whose approvals this person is standing in for today (see approval_delegations). */
  standingInFor?: readonly string[];
}

/** Who is deciding: the signed-in person, and whom they stand in for today. */
export interface Approver {
  id: string;
  roles: Role[];
  standingInFor?: readonly string[];
}

/**
 * Who decides a person's requests (leave, day changes, the month): their manager, someone standing in for that
 * manager today, or an admin when they have no manager. Never themselves, whatever else is true.
 */
export function decidesFor(actor: Approver, employee: { id: string; managerId: string | null }): boolean {
  if (actor.id === employee.id) return false;
  if (!employee.managerId) return actor.roles.includes('admin');
  return employee.managerId === actor.id || !!actor.standingInFor?.includes(employee.managerId);
}

/** The manager this decision is made for, when the actor is standing in for them; null when it's their own call. */
export function onBehalfOf(actor: Approver, employee: { managerId: string | null }): string | null {
  const m = employee.managerId;
  return m && m !== actor.id && actor.standingInFor?.includes(m) ? m : null;
}

export type Permission =
  /** Add and edit people, their manager, assignments and schedules; import from Excel. */
  | 'people.manage'
  /** Add and edit clients, calendars and holidays. */
  | 'clients.manage'
  /** Overtime rates, home calendar, roles; reopen a closed month. */
  | 'settings.manage'
  /** See every person's month and download the Excel export. */
  | 'reports.view'
  /** Close a month for payroll once every timesheet is approved. */
  | 'months.close';

const GRANTS: Record<Permission, Role[]> = {
  'people.manage': ['hr', 'admin'],
  'clients.manage': ['hr', 'admin'],
  'settings.manage': ['admin'],
  'reports.view': ['hr', 'finance', 'admin'],
  'months.close': ['hr', 'admin'],
};

export function can(user: Pick<CurrentUser, 'roles'> | null, permission: Permission): boolean {
  return !!user && user.roles.some((r) => GRANTS[permission].includes(r));
}
