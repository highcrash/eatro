import { Component, type ReactNode } from 'react';

/** If a screen ever crashes, show a way back instead of a blank page. */
export default class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean; message: string }> {
  state = { failed: false, message: '' };

  static getDerivedStateFromError(err: unknown) {
    return { failed: true, message: err instanceof Error ? err.message : String(err) };
  }

  componentDidCatch(err: unknown) {
    console.error('Staff chat screen crashed', err);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="min-h-[100dvh] bg-cream flex flex-col items-center justify-center gap-4 p-6 text-center">
        <img src="/icon-192.png" alt="" className="w-16 h-16 rounded-2xl" />
        <p className="font-semibold text-ink">Something went wrong on this screen.</p>
        <p className="text-xs text-ink-soft break-all">{this.state.message}</p>
        <div className="flex gap-2">
          <button onClick={() => window.location.reload()} className="px-4 py-2.5 rounded-xl bg-beet text-white text-sm font-semibold">
            Reload
          </button>
          <button
            onClick={() => {
              window.history.replaceState(null, '', '/');
              window.location.reload();
            }}
            className="px-4 py-2.5 rounded-xl bg-white border border-ink-line text-sm font-semibold"
          >
            Back to chats
          </button>
        </div>
      </div>
    );
  }
}
