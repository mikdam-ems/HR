import type { DB } from '@/db';
import { auditLog } from '@/db/schema';

/** Records who changed what. Every mutation in src/server calls this. */
export async function audit(
  db: Pick<DB, 'insert'>,
  entry: { actorId: string | null; action: string; entity: string; entityId?: string; before?: unknown; after?: unknown },
): Promise<void> {
  await db.insert(auditLog).values({
    actorId: entry.actorId,
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entityId ?? null,
    before: entry.before ?? null,
    after: entry.after ?? null,
  });
}
