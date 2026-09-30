import { redirect } from 'next/navigation';
import { requireUser } from '@/server/session';

/** Your own attendance log. */
export default async function MyAttendance({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser();
  const month = (await searchParams).month;
  redirect(`/attendance/${user.id}${month && /^\d{4}-\d{2}$/.test(month) ? `?month=${month}` : ''}`);
}
