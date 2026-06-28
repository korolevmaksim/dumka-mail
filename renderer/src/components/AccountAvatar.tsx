import { useState } from 'react';
import { Account } from '../../../shared/types';

/** Deterministic avatar color from an email/name string. */
export function colorFromString(s: string): string {
  let hash = 0;
  for (let i = 0; i < s.length; i++) hash = s.charCodeAt(i) + ((hash << 5) - hash);
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 52%, 52%)`;
}

export function AccountAvatar({ acc, showAvatars = true }: { acc: Account; showAvatars?: boolean }) {
  const [imgError, setImgError] = useState(false);

  if (showAvatars && acc.avatarUrl && !imgError) {
    return (
      <img
        src={acc.avatarUrl}
        alt={acc.email}
        className="w-full h-full rounded-xl object-cover"
        onError={() => setImgError(true)}
      />
    );
  }

  return <>{acc.email.substring(0, 2).toUpperCase()}</>;
}

export function SettingsAccountAvatar({ acc }: { acc: Account }) {
  const [imgError, setImgError] = useState(false);

  if (acc.avatarUrl && !imgError) {
    return (
      <img
        src={acc.avatarUrl}
        alt={acc.email}
        className="w-6 h-6 rounded-full object-cover border border-[var(--border)]"
        onError={() => setImgError(true)}
      />
    );
  }

  return (
    <div
      className="w-6 h-6 rounded-full flex items-center justify-center text-[calc(10px*var(--font-scale))] font-bold text-white shrink-0"
      style={{ backgroundColor: acc.colorHex }}
    >
      {acc.email.substring(0, 2).toUpperCase()}
    </div>
  );
}
