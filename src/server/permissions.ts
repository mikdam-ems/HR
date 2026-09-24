import type { Role } from '@/db/schema';

export interface CurrentUser {
  id: string;
  email: string;
  nameEn: string;
  nameAr: string | null;
  roles: Role[];
  /** True when at least one active employee reports to this person. */
  isManager: boolean;
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
