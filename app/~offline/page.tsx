'use client'

export default function OfflinePage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
      <div className="max-w-sm space-y-5 px-6 text-center">
        <div className="space-y-2">
          <h1 className="font-mono text-2xl font-bold tracking-tight">DoneWell Audio</h1>
          <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground/60">
            Offline
          </p>
        </div>
        <p className="text-sm leading-relaxed text-muted-foreground">
          The app could not load from cache. Once DoneWell Audio has loaded once,
          the analyzer shell and audio analysis run locally from this browser.
        </p>
        <button
          onClick={() => window.location.reload()}
          className="w-full cursor-pointer rounded-md bg-primary px-4 py-2.5 font-mono text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Try Again
        </button>
      </div>
    </div>
  );
}
