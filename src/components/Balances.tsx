import { fmt } from '@/i18n';
import type { Dict } from '@/i18n/en';
import type { Balance } from '@/server/leave';

const n = (x: number) => String(Math.round(x * 10) / 10);

export function Balances({ balances, t }: { balances: Balance[]; t: Dict }) {
  return (
    <div className="balances">
      {balances.map((b) => (
        <div key={b.type} className="card balance">
          <span className="label">{t.timesheet.leaveTypes[b.type]}</span>
          <div className="row" style={{ alignItems: 'baseline', gap: 6 }}>
            <strong className={b.available < 0 ? 'negative' : undefined}>{n(b.available)}</strong>
            <span className="muted">{t.timeOff.available}</span>
          </div>
          <span className="muted small">
            {[
              fmt(t.timeOff.ofEntitlement, { n: n(b.entitlement) }),
              fmt(t.timeOff.taken, { n: n(b.taken) }),
              b.pending ? fmt(t.timeOff.pendingDays, { n: n(b.pending) }) : null,
              b.adjustments ? fmt(t.timeOff.adjusted, { n: (b.adjustments > 0 ? '+' : '') + n(b.adjustments) }) : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </div>
      ))}
    </div>
  );
}
