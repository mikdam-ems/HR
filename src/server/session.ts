import { and, eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { auth } from '@/auth';
import { getDb } from '@/db';
import { employees } from '@/db/schema';
import { can, type CurrentUser, type Permission } from './permissions';

/**
 * The signed-in employee, read fresh from the database on every request, so deactivating someone
 * or changing their roles takes effect immediately.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const session = await auth();
  const email = session?.user?.email?.toLowerCase();
  if (!email) return null;

  const db = await getDb();
  const [me] = await db.select().from(employees).where(eq(employees.email, email));
  if (!me?.active) return null;
  const reports = await db
    .select({ id: employees.id })
    .from(employees)
    .where(and(eq(employees.managerId, me.id), eq(employees.active, true)))
    .limit(1);

  return { id: me.id, email: me.email, nameEn: me.nameEn, nameAr: me.nameAr, roles: me.roles, isManager: reports.length > 0 };
});

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect('/signin');
  return user;
}

export async function requirePermission(permission: Permission): Promise<CurrentUser> {
  const user = await requireUser();
  if (!can(user, permission)) redirect('/?error=forbidden');
  return user;
}
