'use client';

import { useActionState } from 'react';
import { importPeopleAction } from '@/app/(app)/people/actions';
import type { Dict } from '@/i18n/en';

const fill = (s: string, vars: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k]));

export function ImportForm({ t }: { t: Dict['import'] }) {
  const [result, action, pending] = useActionState(importPeopleAction, null);
  return (
    <div className="stack">
      <form action={action} className="card">
        <div className="field" style={{ maxWidth: 420 }}>
          <label htmlFor="file">{t.file}</label>
          <input id="file" name="file" type="file" accept=".xlsx" required />
        </div>
        <div>
          <button className="btn btn-primary" disabled={pending}>
            {pending ? t.working : t.submit}
          </button>
        </div>
      </form>
      {result && result.errors.length === 0 ? (
        <div className="flash" role="status">
          {fill(t.done, { created: result.created, updated: result.updated })}
        </div>
      ) : null}
      {result && result.errors.length > 0 ? (
        <div className="flash flash-error" role="alert">
          <p style={{ margin: '0 0 8px' }}>{t.failed}</p>
          <ul style={{ margin: 0, paddingInlineStart: 18 }}>
            {result.errors.map((e, i) => (
              <li key={i}>
                {e.row ? `${fill(t.row, { row: e.row })}: ` : ''}
                {e.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
