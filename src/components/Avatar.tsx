import { initials } from '@/lib/format';

export interface AvatarPerson {
  id: string;
  nameEn: string;
  /** Employee rows carry photoUpdatedAt; the signed-in user carries photoVersion. */
  photoUpdatedAt?: Date | null;
  photoVersion?: number | null;
}

/** Photo if the person has one, else initials; optionally today's status emoji as a small badge. */
export function Avatar({
  person,
  size = 'md',
  status,
}: {
  person: AvatarPerson;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  status?: { emoji: string; text: string | null } | null;
}) {
  const version = person.photoVersion ?? person.photoUpdatedAt?.getTime() ?? null;
  return (
    <span className={`avatar avatar-${size}`} aria-hidden="true">
      {version ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/api/photo/${person.id}?v=${version}`} alt="" loading="lazy" />
      ) : (
        initials(person.nameEn)
      )}
      {status ? (
        <span className="avatar-status" title={status.text ?? undefined}>
          {status.emoji}
        </span>
      ) : null}
    </span>
  );
}
