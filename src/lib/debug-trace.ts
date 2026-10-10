export const DEBUG_TRACE_STORAGE_KEY = "openexcel-debug-trace";
export const DEBUG_TRACE_HEADER = "X-OpenExcel-Trace-Id";

export interface DebugTrace {
  id: string;
  startedAt: number;
}

export function isDebugTraceEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(DEBUG_TRACE_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function createDebugTrace(): DebugTrace | null {
  if (!isDebugTraceEnabled()) return null;
  const id = `ox-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return { id, startedAt: performance.now() };
}

export function debugTrace(
  trace: DebugTrace | null | undefined,
  stage: string,
  details?: Record<string, unknown>,
): void {
  if (!trace || !isDebugTraceEnabled()) return;
  const elapsedMs = Math.round(performance.now() - trace.startedAt);
  if (details) {
    console.debug(`[OpenExcel trace:${trace.id}] ${stage} +${elapsedMs}ms`, details);
  } else {
    console.debug(`[OpenExcel trace:${trace.id}] ${stage} +${elapsedMs}ms`);
  }
}
