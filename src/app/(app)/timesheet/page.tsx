import { redirect } from 'next/navigation';
import { requireUser } from '@/server/session';

export default async function MyTimesheet({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser();
  const { month } = await searchParams;
  redirect(`/timesheet/${user.id}${month ? `?month=${encodeURIComponent(month)}` : ''}`);
}
