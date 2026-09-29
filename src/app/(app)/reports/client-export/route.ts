import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { clients } from '@/db/schema';
import { buildMonthWorkbook, clientMonthReport, monthReport } from '@/server/reports';
import { getCurrentUser } from '@/server/session';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One client's hours for a month, as Excel: for a client that asks for the hours of the EMS people placed with them. */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return new Response('Unauthorized', { status: 401 });
  const params = new URL(request.url).searchParams;
  const month = params.get('month') ?? '';
  const clientId = params.get('client') ?? '';
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12 || !UUID.test(clientId)) return new Response('Bad request', { status: 400 });

  const db = await getDb();
  const [client] = await db.select().from(clients).where(eq(clients.id, clientId));
  if (!client) return new Response('Unknown client', { status: 404 });
  const report = await monthReport(db, user, Number(m[1]), Number(m[2]));
  if (!report.ok) return new Response('Forbidden', { status: 403 });
  const workbook = await buildMonthWorkbook(clientMonthReport(report.value, clientId), undefined, `${client.nameEn} · Hours`);
  const slug = client.nameEn.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'client';
  return new Response(new Uint8Array(workbook), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="ems-${slug}-hours-${month}.xlsx"`,
      'Cache-Control': 'no-store',
    },
  });
}
