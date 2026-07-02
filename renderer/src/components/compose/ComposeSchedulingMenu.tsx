import { CalendarPlus, Link2 } from 'lucide-react';
import { SendLaterMenu } from './SendLaterMenu';

interface ComposeSchedulingMenuProps {
  onScheduleSend: (date: Date) => void;
  onInsertGoogleMeet: () => void;
  onInsertAvailability: () => void;
  onInsertCalendly: () => void;
  onInsertCalCom: () => void;
}

export function ComposeSchedulingMenu({
  onScheduleSend,
  onInsertGoogleMeet,
  onInsertAvailability,
  onInsertCalendly,
  onInsertCalCom,
}: ComposeSchedulingMenuProps) {
  return (
    <div className="absolute bottom-10 right-16 z-50 w-[270px] rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] p-1.5 shadow-xl">
      <SendLaterMenu onSchedule={onScheduleSend} floating={false} />
      <div className="my-1 ml-1 h-[1px] bg-[var(--border)]" />
      <button
        type="button"
        onClick={onInsertGoogleMeet}
        className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] hover:bg-[var(--hover-row)]"
      >
        <CalendarPlus className="h-3.5 w-3.5" />
        Create Google Meet link
      </button>
      <button
        type="button"
        onClick={onInsertAvailability}
        className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] hover:bg-[var(--hover-row)]"
      >
        <CalendarPlus className="h-3.5 w-3.5" />
        Propose available times
      </button>
      <button
        type="button"
        onClick={onInsertCalendly}
        className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] hover:bg-[var(--hover-row)]"
      >
        <Link2 className="h-3.5 w-3.5" />
        Insert Calendly link
      </button>
      <button
        type="button"
        onClick={onInsertCalCom}
        className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] hover:bg-[var(--hover-row)]"
      >
        <Link2 className="h-3.5 w-3.5" />
        Insert Cal.com link
      </button>
    </div>
  );
}
