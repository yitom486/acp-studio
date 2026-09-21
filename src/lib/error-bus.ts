/**
 * Central frontend error bus.
 * Any layer (SSE consumer, fetch wrappers, global handlers, ErrorBoundary)
 * reports here; ErrorToast renders them in one place so errors never
 * disappear into the console silently.
 */

export interface AppError {
  id: string;
  source: string;
  message: string;
  detail?: string;
  at: number;
}

type Listener = (errors: AppError[]) => void;

const listeners = new Set<Listener>();
let errors: AppError[] = [];
let seq = 0;
let installed = false;

function emit() {
  const snapshot = [...errors];
  for (const fn of listeners) {
    try {
      fn(snapshot);
    } catch {
      // never let the error UI break the app
    }
  }
}

export function subscribeErrors(fn: Listener): () => void {
  listeners.add(fn);
  fn([...errors]);
  return () => {
    listeners.delete(fn);
  };
}

export function reportError(source: string, err: unknown, detail?: string): AppError {
  const message = err instanceof Error ? err.message : String(err ?? "未知错误");
  const entry: AppError = {
    id: `err-${Date.now()}-${seq++}`,
    source,
    message,
    detail: detail ?? (err instanceof Error ? err.stack?.split("\n").slice(0, 6).join("\n") : undefined),
    at: Date.now(),
  };
  errors = [entry, ...errors].slice(0, 20);
  // Always keep a console trace for devtools.
  console.error(`[${source}]`, err);
  emit();
  return entry;
}

export function dismissError(id: string) {
  errors = errors.filter((e) => e.id !== id);
  emit();
}

export function clearErrors() {
  errors = [];
  emit();
}

/** Capture window errors / unhandled rejections into the bus (call once). */
export function installGlobalErrorCapture() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("error", (ev) => {
    reportError("window.onerror", ev.error || ev.message);
  });
  window.addEventListener("unhandledrejection", (ev) => {
    reportError("unhandledrejection", ev.reason);
  });
}
