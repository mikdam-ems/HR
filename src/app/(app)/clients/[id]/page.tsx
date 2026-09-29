import Link from 'next/link';
import { Reveal } from '@/components/Reveal';
import { notFound } from 'next/navigation';
import { addSeasonAction, removeSeasonAction, retireShiftAction, saveShiftAction, updateClientAction } from '@/app/(app)/clients/actions';
import { Avatar } from '@/components/Avatar';
import { StatusLine } from '@/components/StatusLine';
import { Flash } from '@/components/Flash';
import { getDb } from '@/db';
import { fmt, getDict, localName } from '@/i18n';
import type { Dict } from '@/i18n/en';
import { formatDate, formatHours, todayISO } from '@/lib/format';
import { getClientProfile, listCalendars, type ClientProfile } from '@/server/clients';
import { upcomingLeaveForClient } from '@/server/leave';
import { listSeasons } from '@/server/seasons';
import { listShifts, shiftRoster } from '@/server/shifts';
import { windowMinutes } from '@/domain';
import type { ClientShiftRow } from '@/db/schema';
import { can } from '@/server/permissions';
import { currentStatus } from '@/server/profile';
import { requireUser } from '@/server/session';

/** A client's page: who works on it now, its calendar and holidays. Everyone can see it; HR edits it. */
export default async function ClientPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string>>;
}) {
  const user = await requireUser();
  const { t, locale } = await getDict();
  const db = await getDb();
  const today = todayISO();
  const profile = await getClientProfile(db, (await params).id, today);
  if (!profile) notFound();
  const { client, current, upcoming, past, upcomingHolidays } = profile;
  const manage = can(user, 'clients.manage');
  const [calendarRows, leave, shifts, roster, seasons] = await Promise.all([
    manage ? listCalendars(db) : Promise.resolve([]),
    client.isInternal ? Promise.resolve([]) : upcomingLeaveForClient(db, client.id, today),
    listShifts(db, client.id),
    shiftRoster(db, client.id, today),
    listSeasons(db, client.id),
  ]);
  const shiftOf = new Map(shifts.flatMap((sh) => (roster[sh.id] ?? []).map((id) => [id, sh.name] as const)));
  const byId = new Map(current.map((a) => [a.employee.id, a.employee]));
  const offDays = [0, 1, 2, 3, 4, 5, 6].filter((d) => !client.calendar.workWeek.includes(d)).map((d) => t.weekdays[d]);
  const departments = [...new Map(current.flatMap((a) => (a.employee.department ? [[a.employee.department.id, a.employee.department]] : []))).values()];
  const d = (iso: string) => formatDate(iso, locale, { day: 'numeric', month: 'short', year: 'numeric' });

  return (
    <>
      <Flash search={await searchParams} t={t} />
      <Link href={manage ? '/clients' : '/people'} className="small back-link">
        <span className="flip" aria-hidden="true">←</span> {manage ? t.client.back : t.nav.people}
      </Link>

      <div className="bento">
        <section className="card card-dark span-8 dept-hero">
          <span className="eyebrow">{t.client.eyebrow}</span>
          <div className="row">
            <h1>{localName(locale, client.nameEn, client.nameAr)}</h1>
            {!client.active ? <span className="badge badge-danger">{t.clients.inactive}</span> : null}
          </div>
          <div className="row" style={{ gap: 8 }}>
            <span className="chip">
              <span className="chip-label">{t.clients.calendar}</span>
              {client.calendar.name}
            </span>
            <span className="chip">
              <span className="chip-label">{t.client.daysOff}</span>
              {offDays.join(', ') || '—'}
            </span>
          </div>
          {departments.length ? (
            <div className="row" style={{ gap: 6 }}>
              {departments.map((dep) => (
                <Link key={dep.id} href={`/people/departments/${dep.id}`} className="chip">
                  {localName(locale, dep.nameEn, dep.nameAr)}
                </Link>
              ))}
            </div>
          ) : null}
        </section>
        <div className="span-4 stack" style={{ gap: 20 }}>
          <section className="card kpi">
            <span className="label">{t.client.onClient}</span>
            <strong className="kpi-value">{current.length}</strong>
            <div className="avatars">
              {current.slice(0, 8).map((a) => (
                <span key={a.id} className="avatar-link" title={a.employee.nameEn}>
                  <Avatar person={a.employee} size="sm" />
                </span>
              ))}
            </div>
          </section>
          <section className="card">
            <span className="label">{t.client.holidays}</span>
            {upcomingHolidays.length ? (
              <ul className="holiday-list">
                {upcomingHolidays.map((h) => (
                  <li key={h.id}>
                    <strong>{formatDate(h.date, locale, { day: 'numeric', month: 'short' })}</strong>
                    <span>{locale === 'ar' && h.nameAr ? h.nameAr : h.nameEn}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <span className="muted small">{t.client.noHolidays}</span>
            )}
          </section>
        </div>

        <section className="card span-12" aria-labelledby="shifts">
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div className="stack" style={{ gap: 2 }}>
              <h2 id="shifts">{t.shifts.title}</h2>
              <span className="muted small">{t.shifts.hint}</span>
            </div>
            <Link className="btn btn-small" href={`/clients/${client.id}/roster`}>
              {t.roster.open}
            </Link>
          </div>
          <ul className="shift-list">
            {shifts.map((sh) => {
              const people = (roster[sh.id] ?? []).map((id) => byId.get(id)).filter((e) => !!e);
              return (
                <li key={sh.id} className="shift-row">
                  <div className="shift-main">
                    <strong>{sh.name}</strong>
                    <span className="shift-hours" dir="ltr">
                      {sh.startTime}–{sh.endTime}
                    </span>
                    <span className="muted small">
                      {fmt(t.shifts.perDay, { hours: formatHours(Math.max(0, windowMinutes(sh.startTime, sh.endTime) - sh.breakMinutes), locale) })}
                      {sh.endTime <= sh.startTime ? ` · ${t.shifts.overnight}` : ''}
                    </span>
                  </div>
                  <div className="row" style={{ gap: 10 }}>
                    <div className="avatars">
                      {people.slice(0, 6).map((e) => (
                        <Link key={e!.id} href={`/people/${e!.id}`} className="avatar-link" title={e!.nameEn}>
                          <Avatar person={e!} size="sm" />
                        </Link>
                      ))}
                    </div>
                    <span className="muted small">{fmt(t.shifts.people, { count: people.length })}</span>
                  </div>
                  {manage ? (
                    <details className="shift-edit">
                      <summary className="btn btn-small">{t.shifts.edit}</summary>
                      <ShiftForm shift={sh} clientId={client.id} t={t} />
                      <form action={retireShiftAction}>
                        <input type="hidden" name="id" value={sh.id} />
                        <input type="hidden" name="clientId" value={client.id} />
                        <button className="btn btn-small btn-danger">{t.shifts.retire}</button>
                      </form>
                    </details>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {manage ? (
            <Reveal label={t.shifts.add} cancelLabel={t.form.cancel} primary>
              <div className="card reveal-card">
                <h3>{t.shifts.add}</h3>
                <ShiftForm clientId={client.id} t={t} nextOrder={shifts.length} />
              </div>
            </Reveal>
          ) : null}
        </section>

        <section className="card span-12" aria-labelledby="seasons">
          <div className="stack" style={{ gap: 2 }}>
            <h2 id="seasons">{t.seasons.title}</h2>
            <span className="muted small">{t.seasons.hint}</span>
          </div>
          {seasons.length ? (
            <ul className="shift-list">
              {seasons.map((se) => {
                const shift = shifts.find((sh) => sh.id === se.clientShiftId);
                const state = se.fromDate <= today && today <= se.toDate ? 'now' : se.toDate < today ? 'past' : null;
                return (
                  <li key={se.id} className="shift-row">
                    <div className="shift-main">
                      <strong>{se.name}</strong>
                      <span className="shift-hours" dir="ltr">
                        {se.startTime}–{se.endTime}
                      </span>
                      <span className="muted small">
                        {d(se.fromDate)} – {d(se.toDate)} ·{' '}
                        {fmt(t.shifts.perDay, { hours: formatHours(Math.max(0, windowMinutes(se.startTime, se.endTime) - se.breakMinutes), locale) })}
                      </span>
                    </div>
                    <div className="row" style={{ gap: 8 }}>
                      <span className="where-chip">{shift ? shift.name : t.seasons.everyone}</span>
                      {state ? <span className={`badge ${state === 'now' ? 'badge-brand' : 'badge-weekend'}`}>{t.seasons[state]}</span> : null}
                    </div>
                    {manage ? (
                      <form action={removeSeasonAction}>
                        <input type="hidden" name="id" value={se.id} />
                        <input type="hidden" name="clientId" value={client.id} />
                        <button className="btn btn-small btn-danger">{t.seasons.remove}</button>
                      </form>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <span className="muted">{t.seasons.none}</span>
          )}
          {manage ? (
            <Reveal label={t.seasons.add} cancelLabel={t.form.cancel}>
              <div className="card reveal-card">
                <h3>{t.seasons.add}</h3>
                <form action={addSeasonAction} className="stack" style={{ marginTop: 12 }}>
                  <input type="hidden" name="clientId" value={client.id} />
                  <div className="grid-form">
                    <div className="field">
                      <label htmlFor="season-name">{t.seasons.name}</label>
                      <input id="season-name" name="name" type="text" required maxLength={60} placeholder={t.seasons.namePlaceholder} />
                    </div>
                    <div className="field">
                      <label htmlFor="season-from">{t.seasons.from}</label>
                      <input id="season-from" name="fromDate" type="date" required />
                    </div>
                    <div className="field">
                      <label htmlFor="season-to">{t.seasons.to}</label>
                      <input id="season-to" name="toDate" type="date" required />
                    </div>
                    <div className="field">
                      <label htmlFor="season-start">{t.shifts.start}</label>
                      <input id="season-start" name="startTime" type="time" required defaultValue="09:00" />
                    </div>
                    <div className="field">
                      <label htmlFor="season-end">{t.shifts.end}</label>
                      <input id="season-end" name="endTime" type="time" required defaultValue="15:00" />
                    </div>
                    <div className="field">
                      <label htmlFor="season-break">{t.shifts.break}</label>
                      <input id="season-break" name="breakMinutes" type="number" min={0} max={240} defaultValue={0} />
                    </div>
                    {shifts.length > 1 ? (
                      <div className="field">
                        <label htmlFor="season-shift">{t.seasons.appliesTo}</label>
                        <select id="season-shift" name="clientShiftId" defaultValue="">
                          <option value="">{t.seasons.everyone}</option>
                          {shifts.map((sh) => (
                            <option key={sh.id} value={sh.id}>
                              {sh.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : null}
                  </div>
                  <span className="muted small">{t.seasons.closedHint}</span>
                  <button className="btn btn-primary" style={{ alignSelf: 'flex-start' }}>
                    {t.seasons.add}
                  </button>
                </form>
              </div>
            </Reveal>
          ) : null}
        </section>

        <section className="card span-12">
          <h2>{t.client.peopleNow}</h2>
          {current.length ? (
            <People
              rows={current}
              t={t}
              locale={locale}
              note={(a) =>
                [shiftOf.get(a.employee.id), fmt(t.client.since, { date: d(a.startDate) }) + (a.endDate ? ` · ${fmt(t.client.until, { date: d(a.endDate) })}` : '')]
                  .filter(Boolean)
                  .join(' · ')
              }
            />
          ) : (
            <span className="muted">{t.client.nobody}</span>
          )}
        </section>

        {!client.isInternal ? (
          <section className="card span-12">
            <div className="stack" style={{ gap: 2 }}>
              <h2>{t.client.upcomingLeave}</h2>
              <span className="muted small">{t.client.upcomingLeaveHint}</span>
            </div>
            {leave.length ? (
              <ul className="list-rows">
                {leave.map((r) => (
                  <li key={r.id}>
                    <Link className="person" href={`/people/${r.employee.id}`}>
                      <Avatar person={r.employee} size="sm" />
                      <span className="stack" style={{ gap: 0 }}>
                        {localName(locale, r.employee.nameEn, r.employee.nameAr)}
                        <span className="muted small">
                          {t.timesheet.leaveTypes[r.type]} · {formatDate(r.fromDate, locale, { day: 'numeric', month: 'short' })}
                          {r.toDate !== r.fromDate ? ` – ${formatDate(r.toDate, locale, { day: 'numeric', month: 'short' })}` : ''}
                        </span>
                      </span>
                    </Link>
                    <span className="row" style={{ gap: 6 }}>
                      <span className={`badge status-${r.status}`}>{t.timeOff.status[r.status]}</span>
                      {r.clientNotifiedAt ? (
                        <span className="badge badge-client_holiday" title={r.clientNotifiedNote ?? undefined}>
                          ✓ {fmt(t.timeOff.clientInformed, { client: localName(locale, client.nameEn, client.nameAr), date: formatDate(r.clientNotifiedAt.toISOString().slice(0, 10), locale, { day: 'numeric', month: 'short' }) })}
                        </span>
                      ) : (
                        <span className="badge badge-special_overtime">
                          {fmt(t.timeOff.clientNotInformed, { client: localName(locale, client.nameEn, client.nameAr) })}
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <span className="muted small">{t.client.noUpcomingLeave}</span>
            )}
          </section>
        ) : null}

        {upcoming.length ? (
          <section className="card span-6">
            <h2>{t.client.upcoming}</h2>
            <People rows={upcoming} t={t} locale={locale} note={(a) => fmt(t.client.since, { date: d(a.startDate) })} compact />
          </section>
        ) : null}
        {past.length ? (
          <section className="card span-6">
            <h2>{t.client.past}</h2>
            <People rows={past} t={t} locale={locale} note={(a) => fmt(t.client.ended, { date: d(a.endDate!) })} compact />
          </section>
        ) : null}

        {manage ? (
          <details className="card span-12">
            <summary className="btn btn-small" style={{ alignSelf: 'flex-start' }}>
              {t.client.edit}
            </summary>
            <form action={updateClientAction} className="stack" style={{ marginTop: 16 }}>
              <input type="hidden" name="id" value={client.id} />
              <div className="grid-form">
                <div className="field">
                  <label htmlFor="nameEn">{t.clients.name}</label>
                  <input id="nameEn" name="nameEn" type="text" required defaultValue={client.nameEn} />
                </div>
                <div className="field">
                  <label htmlFor="nameAr">{t.clients.nameAr}</label>
                  <input id="nameAr" name="nameAr" type="text" dir="rtl" lang="ar" defaultValue={client.nameAr ?? ''} />
                </div>
                <div className="field">
                  <label htmlFor="calendarId">{t.clients.calendar}</label>
                  <select id="calendarId" name="calendarId" defaultValue={client.calendarId}>
                    {calendarRows.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="field">
                <label htmlFor="leaveContact">{t.client.leaveContact}</label>
                <input id="leaveContact" name="leaveContact" type="text" maxLength={200} defaultValue={client.leaveContact ?? ''} />
                <span className="muted small">{t.client.leaveContactHint}</span>
              </div>
              <label className="check">
                <input type="checkbox" name="active" defaultChecked={client.active} />
                {t.clients.active}
              </label>
              <label className="check">
                <input type="checkbox" name="isInternal" defaultChecked={client.isInternal} />
                {t.client.isInternal}
              </label>
              <div>
                <button className="btn btn-primary">{t.form.save}</button>
              </div>
            </form>
          </details>
        ) : null}
      </div>
    </>
  );
}

type Row = ClientProfile['current'][number];

function People({
  rows,
  t,
  locale,
  note,
  compact = false,
}: {
  rows: Row[];
  t: Dict;
  locale: 'en' | 'ar';
  note: (a: Row) => string;
  compact?: boolean;
}) {
  return (
    <ul className={compact ? 'list-rows' : 'member-grid'}>
      {rows.map((a) => {
        const e = a.employee;
        const status = currentStatus(e);
        return (
          <li key={a.id}>
            <Link href={`/people/${e.id}`} className={compact ? 'person' : 'member-card'}>
              <Avatar person={e} size={compact ? 'sm' : 'lg'} status={status} />
              <span className="stack" style={{ gap: 2, minWidth: 0 }}>
                <strong style={{ fontWeight: compact ? 500 : 600 }}>{localName(locale, e.nameEn, e.nameAr)}</strong>
                <span className="muted small">
                  {[e.jobTitle, e.department ? localName(locale, e.department.nameEn, e.department.nameAr) : null].filter(Boolean).join(' · ')}
                </span>
                <StatusLine status={status} presets={t.status.presets} />
                {!compact ? <span className="small">{note(a)}</span> : null}
              </span>
              {!compact && !a.primary ? <span className="pill pill-muted member-meta">{t.client.secondary}</span> : null}
            </Link>
            {compact ? <span className="muted small">{note(a)}</span> : null}
          </li>
        );
      })}
    </ul>
  );
}

function ShiftForm({ shift, clientId, t, nextOrder = 0 }: { shift?: ClientShiftRow; clientId: string; t: Dict; nextOrder?: number }) {
  const p = shift?.id ?? 'new';
  return (
    <form action={saveShiftAction} className="stack" style={{ marginTop: 12 }}>
      {shift ? <input type="hidden" name="id" value={shift.id} /> : null}
      <input type="hidden" name="clientId" value={clientId} />
      <div className="grid-form">
        <div className="field">
          <label htmlFor={`sn-${p}`}>{t.shifts.name}</label>
          <input id={`sn-${p}`} name="name" type="text" required maxLength={60} defaultValue={shift?.name ?? ''} placeholder="Shift A — Morning" />
        </div>
        <div className="field">
          <label htmlFor={`ss-${p}`}>{t.shifts.start}</label>
          <input id={`ss-${p}`} name="startTime" type="time" required defaultValue={shift?.startTime ?? '09:00'} />
        </div>
        <div className="field">
          <label htmlFor={`se-${p}`}>{t.shifts.end}</label>
          <input id={`se-${p}`} name="endTime" type="time" required defaultValue={shift?.endTime ?? '17:30'} />
        </div>
        <div className="field">
          <label htmlFor={`sb-${p}`}>{t.shifts.break}</label>
          <input id={`sb-${p}`} name="breakMinutes" type="number" min={0} max={240} defaultValue={shift?.breakMinutes ?? 0} />
        </div>
        <div className="field">
          <label htmlFor={`so-${p}`}>{t.shifts.order}</label>
          <input id={`so-${p}`} name="sortOrder" type="number" min={0} max={99} defaultValue={shift?.sortOrder ?? nextOrder} />
        </div>
      </div>
      {shift ? <span className="muted small">{t.shifts.editHint}</span> : null}
      <div>
        <button className="btn btn-primary btn-small">{t.shifts.save}</button>
      </div>
    </form>
  );
}
