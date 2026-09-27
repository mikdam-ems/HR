import { notFound } from 'next/navigation';
import { saveProfileAction } from '@/app/(app)/profile/actions';
import { Avatar } from '@/components/Avatar';
import { Flash } from '@/components/Flash';
import { PhotoInput } from '@/components/PhotoInput';
import { getDb } from '@/db';
import { getDict, localName } from '@/i18n';
import { initials } from '@/lib/format';
import { getEmployeeProfile } from '@/server/people';
import { currentStatus } from '@/server/profile';
import { requireUser } from '@/server/session';

export default async function MyProfilePage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser();
  const { t, locale } = await getDict();
  const me = await getEmployeeProfile(await getDb(), user.id);
  if (!me) notFound();
  const status = currentStatus(me);
  const photo = me.photoUpdatedAt ? `/api/photo/${me.id}?v=${me.photoUpdatedAt.getTime()}` : null;

  return (
    <>
      <Flash search={await searchParams} t={t} />
      <div className="page-head">
        <div className="stack" style={{ gap: 4 }}>
          <h1>{t.me.title}</h1>
          <span className="muted">{t.me.intro}</span>
        </div>
      </div>

      <div className="bento">
        <section className="card profile-hero span-4">
          <Avatar person={me} size="xl" status={status} />
          <div className="stack" style={{ gap: 2, alignItems: 'center' }}>
            <h2 className="profile-name">{localName(locale, me.nameEn, me.nameAr)}</h2>
            <span className="muted">{me.jobTitle}</span>
          </div>
          {status ? (
            <span className="status-chip">
              <span aria-hidden="true">{status.emoji}</span> {status.text ?? t.status.presets[status.emoji as keyof typeof t.status.presets] ?? ''}
            </span>
          ) : null}
          <p className="profile-bio">{me.bio ?? <span className="muted">{t.me.noBio}</span>}</p>
          <dl className="facts" style={{ alignSelf: 'stretch' }}>
            <div>
              <dt>{t.me.email}</dt>
              <dd>{me.email}</dd>
            </div>
            <div>
              <dt>{t.me.department}</dt>
              <dd>{me.department ? localName(locale, me.department.nameEn, me.department.nameAr) : '—'}</dd>
            </div>
            <div>
              <dt>{t.me.manager}</dt>
              <dd>{me.manager ? localName(locale, me.manager.nameEn, me.manager.nameAr) : '—'}</dd>
            </div>
          </dl>
          <span className="muted small">{t.me.keptByHr}</span>
        </section>

        <form action={saveProfileAction} className="card span-8">
          <h2>{t.me.edit}</h2>
          <div className="field">
            <span className="label">{t.me.photo}</span>
            <PhotoInput
              current={photo}
              initials={initials(me.nameEn)}
              labels={{ change: t.me.changePhoto, remove: t.me.removePhoto, hint: t.me.photoHint, error: t.me.photoTooBig }}
            />
          </div>
          <div className="grid-form">
            <div className="field">
              <label htmlFor="nameEn">{t.me.nameEn}</label>
              <input id="nameEn" name="nameEn" type="text" required maxLength={120} defaultValue={me.nameEn} />
            </div>
            <div className="field">
              <label htmlFor="nameAr">{t.me.nameAr}</label>
              <input id="nameAr" name="nameAr" type="text" dir="rtl" lang="ar" maxLength={120} defaultValue={me.nameAr ?? ''} />
            </div>
            <div className="field">
              <label htmlFor="jobTitle">{t.me.jobTitle}</label>
              <input id="jobTitle" name="jobTitle" type="text" maxLength={120} defaultValue={me.jobTitle ?? ''} />
            </div>
          </div>
          <div className="field">
            <label htmlFor="bio">{t.me.bio}</label>
            <textarea id="bio" name="bio" rows={4} maxLength={500} defaultValue={me.bio ?? ''} placeholder={t.me.bioPlaceholder} />
          </div>
          <div>
            <button className="btn btn-primary">{t.me.save}</button>
          </div>
        </form>
      </div>
    </>
  );
}
