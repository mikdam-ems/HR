'use client';

import { useEffect, useState } from 'react';
import { savePushSubscriptionAction } from '@/app/(app)/notifications/actions';

export interface PushLabels {
  enable: string;
  enabled: string;
  blocked: string;
  unsupported: string;
  iosHint: string;
}

type State = 'loading' | 'unsupported' | 'blocked' | 'off' | 'on';

/** Asks this browser for permission and subscribes it to push notifications. */
export function PushToggle({ vapidKey, labels }: { vapidKey: string; labels: PushLabels }) {
  const [state, setState] = useState<State>('loading');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      setState('unsupported');
      return;
    }
    if (Notification.permission === 'denied') {
      setState('blocked');
      return;
    }
    navigator.serviceWorker
      .getRegistration('/sw.js')
      .then((reg) => reg?.pushManager.getSubscription())
      .then((sub) => setState(sub ? 'on' : 'off'))
      .catch(() => setState('off'));
  }, []);

  async function turnOn() {
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setState(permission === 'denied' ? 'blocked' : 'off');
        return;
      }
      const reg = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64ToBytes(vapidKey) }));
      const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
      setState((await savePushSubscriptionAction(json)) ? 'on' : 'off');
    } catch {
      setState('off');
    } finally {
      setBusy(false);
    }
  }

  if (state === 'loading') return null;
  if (state === 'on') return <p className="push-note small">✓ {labels.enabled}</p>;
  if (state === 'blocked') return <p className="push-note small muted">{labels.blocked}</p>;
  if (state === 'unsupported') {
    const ios = /iPhone|iPad/.test(navigator.userAgent);
    return <p className="push-note small muted">{ios ? labels.iosHint : labels.unsupported}</p>;
  }
  return (
    <button type="button" className="btn btn-small push-note" onClick={turnOn} disabled={busy}>
      {labels.enable}
    </button>
  );
}

function base64ToBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}
