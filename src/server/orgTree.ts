export interface OrgPerson {
  id: string;
  managerId: string | null;
  nameEn: string;
}

export interface OrgNode<T extends OrgPerson> {
  person: T;
  reports: OrgNode<T>[];
}

/**
 * Builds the org chart from each person's manager. People whose manager is missing (or inactive, so not
 * in the list) become top-level. Safe against bad data: someone caught in a management loop is shown at the top.
 */
export function buildOrgTree<T extends OrgPerson>(people: readonly T[]): OrgNode<T>[] {
  const byId = new Map(people.map((p) => [p.id, p]));
  const children = new Map<string, T[]>();
  const roots: T[] = [];

  for (const p of people) {
    if (p.managerId && byId.has(p.managerId) && !inLoop(p, byId)) {
      const list = children.get(p.managerId) ?? [];
      list.push(p);
      children.set(p.managerId, list);
    } else {
      roots.push(p);
    }
  }

  const byName = (a: T, b: T) => a.nameEn.localeCompare(b.nameEn);
  const build = (p: T): OrgNode<T> => ({
    person: p,
    reports: (children.get(p.id) ?? []).sort(byName).map(build),
  });
  return roots.sort(byName).map(build);
}

function inLoop(start: OrgPerson, byId: Map<string, OrgPerson>): boolean {
  const seen = new Set<string>([start.id]);
  let cur = start.managerId ? byId.get(start.managerId) : undefined;
  while (cur) {
    if (seen.has(cur.id)) return true;
    seen.add(cur.id);
    cur = cur.managerId ? byId.get(cur.managerId) : undefined;
  }
  return false;
}

/** True if making `managerId` the manager of `employeeId` would create a loop. */
export function wouldCreateLoop(
  employeeId: string,
  managerId: string | null,
  people: readonly Pick<OrgPerson, 'id' | 'managerId'>[],
): boolean {
  if (!managerId) return false;
  if (managerId === employeeId) return true;
  const byId = new Map(people.map((p) => [p.id, p]));
  const seen = new Set<string>();
  let cur: string | null | undefined = managerId;
  while (cur && !seen.has(cur)) {
    if (cur === employeeId) return true;
    seen.add(cur);
    cur = byId.get(cur)?.managerId;
  }
  return false;
}
