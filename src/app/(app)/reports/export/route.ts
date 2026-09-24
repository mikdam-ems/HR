import { getDb } from '@/db';
import { buildMonthWorkbook, monthReport } from '@/server/reports';
import { getCurrentUser } from '@/server/session';

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return new Response('Unauthorized', { status: 401 });
  const month = new URL(request.url).searchParams.get('month') ?? '';
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return new Response('Bad month', { status: 400 });

  const report = await monthReport(await getDb(), user, Number(m[1]), Number(m[2]));
  if (!report.ok) return new Response('Forbidden', { status: 403 });
  return new Response(new Uint8Array(await buildMonthWorkbook(report.value)), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="ems-timesheets-${month}.xlsx"`,
      'Cache-Control': 'no-store',
    },
  });
}
