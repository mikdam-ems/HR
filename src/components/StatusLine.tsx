export type Status = { emoji: string; text: string | null };

/** What someone's status says in words: what they wrote, or the name of the mood they picked. */
export function statusLabel(status: Status, presets: Record<string, string>): string {
  return status.text ?? presets[status.emoji] ?? '';
}

/**
 * Today's status as a line of text beside a person, e.g. "💻 Deep in the release". The avatar badge only has room
 * for the emoji, so wherever the badge appears, this line carries the words.
 */
export function StatusLine({ status, presets }: { status: Status | null; presets: Record<string, string> }) {
  if (!status) return null;
  return (
    <span className="status-line small" dir="auto">
      <span aria-hidden="true">{status.emoji}</span> <span className="status-line-text">{statusLabel(status, presets)}</span>
    </span>
  );
}
