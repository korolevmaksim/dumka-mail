import React from 'react';

// Canonical 26×26 chrome control (Surface.swift IconButton).
// active = accent foreground; hover/active = hoverRow background; 13px icon; r6.
interface IconButtonProps {
  icon: React.ReactNode;
  title: string;
  onClick?: (e: React.MouseEvent) => void;
  isActive?: boolean;
  disabled?: boolean;
  className?: string;
  tone?: 'default' | 'accent' | 'ai' | 'success' | 'danger';
}

const TONE_ACTIVE: Record<NonNullable<IconButtonProps['tone']>, string> = {
  default: 'var(--accent)',
  accent: 'var(--accent)',
  ai: 'var(--ai-accent)',
  success: 'var(--success)',
  danger: 'var(--danger)',
};

export function IconButton({
  icon,
  title,
  onClick,
  isActive = false,
  disabled = false,
  className = '',
  tone = 'default',
}: IconButtonProps) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className={`flex items-center justify-center w-[26px] h-[26px] rounded-[6px] shrink-0 transition-colors duration-100
        ${isActive ? '' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}
        ${isActive ? 'bg-[var(--hover-row)]' : 'hover:bg-[var(--hover-row)]'}
        focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] focus-visible:outline-offset-1
        active:scale-95 active:bg-[var(--hover-row)]
        disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer ${className}`}
      style={isActive ? { color: TONE_ACTIVE[tone] } : undefined}
    >
      <span className="flex items-center justify-center [&_svg]:w-[13px] [&_svg]:h-[13px]">{icon}</span>
    </button>
  );
}
