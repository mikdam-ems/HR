import { redirect } from 'next/navigation';
import type { Result } from '@/server/validation';

/** Text field; empty becomes null. */
export function str(fd: FormData, name: string): string | null {
  const v = fd.get(name);
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

export function bool(fd: FormData, name: string): boolean {
  return fd.get(name) === 'on' || fd.get(name) === 'true';
}

export function strs(fd: FormData, name: string): string[] {
  return fd.getAll(name).filter((v): v is string => typeof v === 'string' && v !== '');
}

/** Only same-site paths, so a crafted form can't redirect people elsewhere. */
export function safePath(path: string | null, fallback = '/'): string {
  return path && path.startsWith('/') && !path.startsWith('//') ? path : fallback;
}

/** After a form: back to `path` with ?ok=… or ?error=… for the flash message. */
export function redirectWith(path: string, result: Result<unknown>, okCode = 'saved'): never {
  const sep = path.includes('?') ? '&' : '?';
  if (result.ok) redirect(`${path}${sep}ok=${okCode}`);
  const detail = result.detail ? `&detail=${encodeURIComponent(result.detail)}` : '';
  redirect(`${path}${sep}error=${result.error}${detail}`);
}
