import Link from 'next/link';
import { notFound } from 'next/navigation';
import { updateClientAction } from '@/app/(app)/clients/actions';
import { Flash } from '@/components/Flash';
import { getDb } from '@/db';
import { getDict } from '@/i18n';
import { listCalendars, listClients } from '@/server/clients';
import { requirePermission } from '@/server/session';

export default async function EditClientPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string>>;
}) {
  await requirePermission('clients.manage');
  const { t } = await getDict();
  const db = await getDb();
  const { id } = await params;
  const [clientRows, calendarRows] = await Promise.all([listClients(db), listCalendars(db)]);
  const client = clientRows.find((c) => c.id === id);
  if (!client) notFound();

  return (
    <>
      <Flash search={await searchParams} t={t} />
      <h1>{t.clients.editClient}</h1>
      <form action={updateClientAction} className="card">
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
        <label className="check">
          <input type="checkbox" name="active" defaultChecked={client.active} />
          {t.clients.active}
        </label>
        <div className="row">
          <button className="btn btn-primary">{t.form.save}</button>
          <Link className="btn" href="/clients">
            {t.form.cancel}
          </Link>
        </div>
      </form>
    </>
  );
}
