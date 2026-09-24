import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  addAssignmentAction,
  endAssignmentAction,
  removeAssignmentAction,
  removeScheduleAction,
  setScheduleAction,
} from '@/app/(app)/people/actions';
import { DayBadge } from '@/components/DayBadge';
import { Flash } from '@/components/Flash';
import { getDb } from '@/db';
import { resolveDay, scheduledMinutes } from '@/domain';
import { getDict, holidayLabel, localName } from '@/i18n';
import { formatDate, formatHours, todayISO } from '@/lib/format';
import { listClients } from '@/server/clients';
import { getEmployeeProfile } from '@/server/people';
import { can } from '@/server/permissions';
import { loadRulesContext } from '@/server/rulesContext';
import { requireUser } from '@/server/session';
import { accessFor } from '@/server/timesheets';

export default async function ProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string>>;
}) {
  const user = await requireUser();
  const { t, locale } = await getDict();
  const db = await getDb();
  const { id } = await params;
  const person = await getEmployeeProfile(db, id);
  if (!person) notFound();

  const manage = can(user, 'people.manage');
  const [ctx, clientRows] = await Promise.all([loadRulesContext(db), manage ? listClients(db) : Promise.resolve([])]);
  const today = todayISO();
  const day = resolveDay(ctx, person.id, today);
  const name = localName(locale, person.nameEn, person.nameAr);

  return (
    <>
      <Flash search={await searchParams} t={t} />
      <div className="page-head">
        <div className="stack" style={{ gap: 4 }}>
          <div className="row">
            <h1>{name}</h1>
            {!person.active ? <span className="badge badge-danger">{t.people.inactive}</span> : null}
            <DayBadge type={day.dayType} t={t} holiday={holidayLabel(locale, day)} />
          </div>
          <span className="muted">
            {[person.jobTitle, person.email].filter(Boolean).join(' · ')}
          </span>
          <span>
            <span className="label">{t.people.manager}: </span>
            {person.manager ? (
              <Link href={`/people/${person.manager.id}`}>
                {localName(locale, person.manager.nameEn, person.manager.nameAr)}
              </Link>
            ) : (
              t.people.none
            )}
          </span>
        </div>
        <div className="row">
          {accessFor(user, person, 'draft').view ? (
            <Link className="btn" href={`/timesheet/${person.id}`}>
              {t.nav.timesheet}
            </Link>
          ) : null}
          {manage ? (
            <Link className="btn" href={`/people/${person.id}/edit`}>
              {t.profile.edit}
            </Link>
          ) : null}
        </div>
      </div>

      <section className="card">
        <h2>{t.profile.reports}</h2>
        {person.reports.length ? (
          <div className="row" style={{ gap: 12 }}>
            {person.reports.map((r) => (
              <Link key={r.id} href={`/people/${r.id}`}>
                {localName(locale, r.nameEn, r.nameAr)}
              </Link>
            ))}
          </div>
        ) : (
          <span className="muted">{t.profile.noReports}</span>
        )}
      </section>

      <section className="stack">
        <h2>{t.profile.assignments}</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t.profile.client}</th>
                <th>{t.profile.from}</th>
                <th>{t.profile.to}</th>
                <th>{t.profile.primary}</th>
                {manage ? <th /> : null}
              </tr>
            </thead>
            <tbody>
              {person.assignments.length === 0 ? (
                <tr>
                  <td colSpan={5} className="muted">
                    {t.profile.noAssignments}
                  </td>
                </tr>
              ) : (
                person.assignments.map((a) => (
                  <tr key={a.id}>
                    <td>{localName(locale, a.client.nameEn, a.client.nameAr)}</td>
                    <td>{formatDate(a.startDate, locale)}</td>
                    <td>{a.endDate ? formatDate(a.endDate, locale) : t.profile.open}</td>
                    <td>{a.primary ? t.profile.primary : t.profile.secondary}</td>
                    {manage ? (
                      <td>
                        <div className="row">
                          {!a.endDate ? (
                            <form action={endAssignmentAction} className="row">
                              <input type="hidden" name="id" value={a.id} />
                              <input type="hidden" name="employeeId" value={person.id} />
                              <input
                                type="date"
                                name="endDate"
                                required
                                aria-label={t.profile.end}
                                style={{ width: 160, minHeight: 32 }}
                              />
                              <button className="btn btn-small">{t.profile.end}</button>
                            </form>
                          ) : null}
                          <form action={removeAssignmentAction}>
                            <input type="hidden" name="id" value={a.id} />
                            <input type="hidden" name="employeeId" value={person.id} />
                            <button className="btn btn-small btn-danger">{t.profile.remove}</button>
                          </form>
                        </div>
                      </td>
                    ) : null}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {manage ? (
          <form action={addAssignmentAction} className="card">
            <input type="hidden" name="employeeId" value={person.id} />
            <h3>{t.profile.addAssignment}</h3>
            <div className="grid-form">
              <div className="field">
                <label htmlFor="clientId">{t.profile.client}</label>
                <select id="clientId" name="clientId" required>
                  {clientRows
                    .filter((c) => c.active)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {localName(locale, c.nameEn, c.nameAr)}
                      </option>
                    ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="startDate">{t.profile.from}</label>
                <input id="startDate" name="startDate" type="date" required defaultValue={today} />
              </div>
              <div className="field">
                <label htmlFor="endDate">{t.profile.to}</label>
                <input id="endDate" name="endDate" type="date" />
              </div>
              <label className="check">
                <input type="checkbox" name="primary" defaultChecked={person.assignments.every((a) => a.endDate && a.endDate < today)} />
                {t.profile.primary}
              </label>
            </div>
            <span className="muted small">{t.profile.primaryHint}</span>
            <div>
              <button className="btn btn-primary">{t.profile.addAssignment}</button>
            </div>
          </form>
        ) : null}
      </section>

      <section className="stack">
        <h2>{t.profile.schedules}</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t.profile.effectiveFrom}</th>
                <th>{t.profile.start}</th>
                <th>{t.profile.endTime}</th>
                <th>{t.home.hours}</th>
                <th>{t.profile.shift}</th>
                {manage ? <th /> : null}
              </tr>
            </thead>
            <tbody>
              {person.schedules.length === 0 ? (
                <tr>
                  <td colSpan={6} className="muted">
                    {t.profile.noSchedules}
                  </td>
                </tr>
              ) : (
                person.schedules.map((s) => (
                  <tr key={s.id}>
                    <td>{formatDate(s.effectiveFrom, locale)}</td>
                    <td>{s.startTime}</td>
                    <td>{s.endTime}</td>
                    <td>
                      {formatHours(
                        scheduledMinutes({
                          employeeId: s.employeeId,
                          effectiveFrom: s.effectiveFrom,
                          start: s.startTime,
                          end: s.endTime,
                          breakMinutes: s.breakMinutes,
                        }),
                      )}
                    </td>
                    <td>{s.shiftCode ?? t.people.none}</td>
                    {manage ? (
                      <td>
                        <form action={removeScheduleAction}>
                          <input type="hidden" name="id" value={s.id} />
                          <input type="hidden" name="employeeId" value={person.id} />
                          <button className="btn btn-small btn-danger">{t.profile.remove}</button>
                        </form>
                      </td>
                    ) : null}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {manage ? (
          <form action={setScheduleAction} className="card">
            <input type="hidden" name="employeeId" value={person.id} />
            <div className="grid-form">
              <div className="field">
                <label htmlFor="effectiveFrom">{t.profile.effectiveFrom}</label>
                <input id="effectiveFrom" name="effectiveFrom" type="date" required defaultValue={today} />
              </div>
              <div className="field">
                <label htmlFor="startTime">{t.profile.start}</label>
                <input id="startTime" name="startTime" type="time" required defaultValue="09:00" />
              </div>
              <div className="field">
                <label htmlFor="endTime">{t.profile.endTime}</label>
                <input id="endTime" name="endTime" type="time" required defaultValue="17:00" />
              </div>
              <div className="field">
                <label htmlFor="breakMinutes">{t.profile.break}</label>
                <input id="breakMinutes" name="breakMinutes" type="number" min={0} max={240} defaultValue={0} />
              </div>
              <div className="field">
                <label htmlFor="shiftCode">{t.profile.shift}</label>
                <input id="shiftCode" name="shiftCode" type="text" placeholder="A / B / C" />
              </div>
            </div>
            <span className="muted small">{t.profile.scheduleHint}</span>
            <div>
              <button className="btn btn-primary">{t.profile.addSchedule}</button>
            </div>
          </form>
        ) : null}
      </section>
    </>
  );
}
