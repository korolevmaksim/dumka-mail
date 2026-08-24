import { Component, type ErrorInfo, type ReactNode } from 'react';

interface RendererErrorBoundaryProps {
  children: ReactNode;
}

interface RendererErrorBoundaryState {
  hasError: boolean;
}

/**
 * Keeps a React render failure from unmounting the whole tree into a blank
 * (black, in dark theme) window. Reload restores a clean document.
 */
export class RendererErrorBoundary extends Component<
  RendererErrorBoundaryProps,
  RendererErrorBoundaryState
> {
  state: RendererErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): RendererErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Renderer error boundary captured a UI failure:', error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="h-screen w-screen flex items-center justify-center bg-[var(--app-bg)] text-[var(--text-primary)] p-8">
        <div className="max-w-md flex flex-col gap-3 text-center">
          <h1 className="text-[calc(16px*var(--font-scale))] font-semibold">Dumka Mail hit a display error</h1>
          <p className="text-[calc(12px*var(--font-scale))] text-[var(--text-secondary)] leading-relaxed">
            The message window went blank. Reload to restore the mailbox. Your mail is still on disk.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="self-center mt-2 px-4 py-2 rounded-md bg-[var(--accent)] text-white text-[calc(12px*var(--font-scale))] font-medium cursor-pointer hover:opacity-90"
          >
            Reload window
          </button>
        </div>
      </div>
    );
  }
}
