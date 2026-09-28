import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { runDaily } from '@/server/daily';

// Vercel Cron calls this every morning with `Authorization: Bearer $CRON_SECRET` (see vercel.json).
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const report = await runDaily(await getDb());
  return NextResponse.json(report);
}
