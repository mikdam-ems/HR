import { buildPeopleTemplate } from '@/server/importPeople';
import { can } from '@/server/permissions';
import { getCurrentUser } from '@/server/session';

export async function GET() {
  if (!can(await getCurrentUser(), 'people.manage')) return new Response('Forbidden', { status: 403 });
  return new Response(new Uint8Array(await buildPeopleTemplate()), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="ems-people-template.xlsx"',
    },
  });
}
