'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/db';
import { hoursSourceOn } from '@/domain';
import { bool, redirectWith, str, strs } from '@/lib/forms';
import { todayISO } from '@/lib/format';
import {
  createCalendar,
  createClient,
  removeHoliday,
  setHoliday,
  updateCalendar,
  updateClient,
} from '@/server/clients';
import { audit } from '@/server/audit';
import { createSeason, deleteSeason } from '@/server/seasons';
import { requirePermission } from '@/server/session';
import { createShift, deactivateShift, updateShift } from '@/server/shifts';
import { getSettings, setHoursSource, setSetting } from '@/server/settings';

export async function createClientAction(fd: FormData) {
  const actor = await requirePermission('clients.manage');
  const result = await createClient(await getDb(), actor.id, {
    nameEn: str(fd, 'nameEn') ?? '',
    nameAr: str(fd, 'nameAr'),
    calendarId: str(fd, 'calendarId') ?? '',
  });
  revalidatePath('/clients');
  redirectWith('/clients', result, 'created');
}

export async function updateClientAction(fd: FormData) {
  const actor = await requirePermission('clients.manage');
  const id = str(fd, 'id') ?? '';
  const result = await updateClient(await getDb(), actor.id, id, {
    nameEn: str(fd, 'nameEn') ?? '',
    nameAr: str(fd, 'nameAr'),
    calendarId: str(fd, 'calendarId') ?? '',
    active: bool(fd, 'active'),
    isInternal: bool(fd, 'isInternal'),
    leaveContact: str(fd, 'leaveContact'),
  });
  revalidatePath('/clients');
  redirectWith(`/clients/${id}`, result);
}

export async function createCalendarAction(fd: FormData) {
  const actor = await requirePermission('clients.manage');
  const result = await createCalendar(await getDb(), actor.id, {
    name: str(fd, 'name') ?? '',
    workWeek: strs(fd, 'workWeek').map(Number),
  });
  revalidatePath('/clients');
  if (result.ok) redirectWith(`/calendars/${result.value}`, result, 'created');
  redirectWith('/clients', result);
}

export async function updateCalendarAction(fd: FormData) {
  const actor = await requirePermission('clients.manage');
  const id = str(fd, 'id') ?? '';
  const result = await updateCalendar(await getDb(), actor.id, id, {
    name: str(fd, 'name') ?? '',
    workWeek: strs(fd, 'workWeek').map(Number),
  });
  redirectWith(`/calendars/${id}`, result);
}

export async function setHolidayAction(fd: FormData) {
  const actor = await requirePermission('clients.manage');
  const calendarId = str(fd, 'calendarId') ?? '';
  const date = str(fd, 'date') ?? '';
  const result = await setHoliday(await getDb(), actor.id, {
    calendarId,
    date,
    nameEn: str(fd, 'nameEn') ?? '',
    nameAr: str(fd, 'nameAr'),
  });
  redirectWith(`/calendars/${calendarId}?year=${date.slice(0, 4)}`, result, 'created');
}

export async function removeHolidayAction(fd: FormData) {
  const actor = await requirePermission('clients.manage');
  const calendarId = str(fd, 'calendarId') ?? '';
  const result = await removeHoliday(await getDb(), actor.id, str(fd, 'id') ?? '');
  redirectWith(`/calendars/${calendarId}?year=${str(fd, 'year') ?? ''}`, result, 'removed');
}

export async function saveSettingsAction(fd: FormData) {
  const actor = await requirePermission('settings.manage');
  const db = await getDb();
  const rate = (name: string) => {
    const n = Number(str(fd, name));
    return Number.isFinite(n) && n >= 1 && n <= 5 ? n : null;
  };
  const regular = rate('regular');
  const special = rate('special');
  const offDay = rate('offDay');
  if (regular === null || special === null || offDay === null) {
    redirectWith('/settings', { ok: false, error: 'invalid_input', detail: 'rates must be between 1 and 5' });
  }
  await setSetting(db, 'homeCalendarId', str(fd, 'homeCalendarId'));
  await setSetting(db, 'overtimeRates', { regular, special, offDay });
  await audit(db, {
    actorId: actor.id,
    action: 'update',
    entity: 'settings',
    after: { homeCalendarId: str(fd, 'homeCalendarId'), overtimeRates: { regular, special, offDay } },
  });
  // Only a real switch adds a period; saving the form as it was leaves the hours source alone.
  const source = str(fd, 'hoursSource') === 'clock' ? 'clock' : 'schedule';
  const from = str(fd, 'hoursFrom') ?? '';
  if (source !== hoursSourceOn((await getSettings(db)).hoursSource, from || todayISO())) {
    const switched = await setHoursSource(db, actor.id, { from, source });
    if (!switched.ok) redirectWith('/settings', switched);
  }
  revalidatePath('/');
  redirectWith('/settings', { ok: true, value: undefined });
}

/** Adds a shift to a client, or edits one (then everyone on it moves to the new hours from today). */
export async function saveShiftAction(fd: FormData) {
  const actor = await requirePermission('clients.manage');
  const db = await getDb();
  const id = str(fd, 'id');
  const clientId = str(fd, 'clientId') ?? '';
  const input = {
    clientId,
    name: str(fd, 'name') ?? '',
    startTime: str(fd, 'startTime') ?? '',
    endTime: str(fd, 'endTime') ?? '',
    breakMinutes: Number(str(fd, 'breakMinutes') ?? 0),
    sortOrder: Number(str(fd, 'sortOrder') ?? 0),
  };
  const result = id ? await updateShift(db, actor.id, id, input) : await createShift(db, actor.id, input);
  revalidatePath(`/clients/${clientId}`);
  redirectWith(`/clients/${clientId}`, result, id ? 'saved' : 'created');
}

/** Adds Ramadan / summer hours to a client. */
export async function addSeasonAction(fd: FormData) {
  const actor = await requirePermission('clients.manage');
  const clientId = str(fd, 'clientId') ?? '';
  const result = await createSeason(await getDb(), actor.id, {
    clientId,
    name: str(fd, 'name') ?? '',
    fromDate: str(fd, 'fromDate') ?? '',
    toDate: str(fd, 'toDate') ?? '',
    startTime: str(fd, 'startTime') ?? '',
    endTime: str(fd, 'endTime') ?? '',
    breakMinutes: Number(str(fd, 'breakMinutes') ?? 0),
    clientShiftId: str(fd, 'clientShiftId') || null,
  });
  revalidatePath('/', 'layout');
  redirectWith(`/clients/${clientId}`, result, 'created');
}

export async function removeSeasonAction(fd: FormData) {
  const actor = await requirePermission('clients.manage');
  const clientId = str(fd, 'clientId') ?? '';
  const result = await deleteSeason(await getDb(), actor.id, str(fd, 'id') ?? '');
  revalidatePath('/', 'layout');
  redirectWith(`/clients/${clientId}`, result, 'removed');
}

export async function retireShiftAction(fd: FormData) {
  const actor = await requirePermission('clients.manage');
  const clientId = str(fd, 'clientId') ?? '';
  const result = await deactivateShift(await getDb(), actor.id, str(fd, 'id') ?? '');
  revalidatePath(`/clients/${clientId}`);
  redirectWith(`/clients/${clientId}`, result, 'removed');
}
