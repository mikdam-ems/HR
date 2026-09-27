'use client';

import { useRef, useState } from 'react';

const SIZE = 256;

/** Picks an image, crops it square and shrinks it in the browser, and hands the form a small JPEG data URL. */
export function PhotoInput({
  current,
  initials,
  labels,
}: {
  current: string | null;
  initials: string;
  labels: { change: string; remove: string; hint: string; error: string };
}) {
  const [preview, setPreview] = useState<string | null>(current);
  const [data, setData] = useState('');
  const [removed, setRemoved] = useState(false);
  const [error, setError] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = () => {
      const side = Math.min(img.naturalWidth, img.naturalHeight);
      const canvas = document.createElement('canvas');
      canvas.width = SIZE;
      canvas.height = SIZE;
      canvas
        .getContext('2d')!
        .drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, SIZE, SIZE);
      const out = canvas.toDataURL('image/jpeg', 0.85);
      URL.revokeObjectURL(url);
      setPreview(out);
      setData(out);
      setRemoved(false);
      setError(false);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      setError(true);
    };
    img.src = url;
  }

  return (
    <div className="photo-input">
      <span className="avatar avatar-xl" aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {preview ? <img src={preview} alt="" /> : initials}
      </span>
      <div className="stack" style={{ gap: 8 }}>
        <div className="row">
          <label className="btn btn-small">
            {labels.change}
            <input ref={file} type="file" accept="image/jpeg,image/png,image/webp" onChange={onPick} className="sr-only" />
          </label>
          {preview ? (
            <button
              type="button"
              className="btn btn-small btn-danger"
              onClick={() => {
                setPreview(null);
                setData('');
                setRemoved(true);
                if (file.current) file.current.value = '';
              }}
            >
              {labels.remove}
            </button>
          ) : null}
        </div>
        <span className="muted small">{error ? labels.error : labels.hint}</span>
      </div>
      <input type="hidden" name="photo" value={data} />
      <input type="hidden" name="removePhoto" value={removed ? '1' : ''} />
    </div>
  );
}
