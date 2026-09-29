import { eq } from 'drizzle-orm';
import type { DB } from '@/db';
import { employees, type Employee } from '@/db/schema';
import { upcomingCelebrations, type Celebration } from '@/domain';

export type CelebrationWithPerson = Celebration & { person: Employee };

/** Birthdays and work anniversaries of active people in the `days` days starting `from`. */
export async function celebrations(db: DB, from: string, days: number): Promise<CelebrationWithPerson[]> {
  const people = await db.select().from(employees).where(eq(employees.active, true));
  const byId = new Map(people.map((p) => [p.id, p]));
  return upcomingCelebrations(people, from, days).map((c) => ({ ...c, person: byId.get(c.employeeId)! }));
}
