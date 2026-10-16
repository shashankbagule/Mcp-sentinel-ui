// MCP-Sentinel has no accounts and no database — "your history" can only
// mean the scans *this browser* kicked off. So a scan is saved here, in
// localStorage, the moment it's started (app/page.tsx), and the History page
// reads the list back and asks the existing status/report APIs for each
// entry's current state. Nothing is uploaded anywhere else, and clearing
// browser data clears this too — that's the intended, honest scope of
// per-user history without adding auth.

export interface HistoryEntry {
  execution_id: string;
  target_url: string;
  dry_run: boolean;
  started_at: string; // ISO timestamp, set client-side when the scan was kicked off
}

const STORAGE_KEY = "mcp-sentinel-history";
const MAX_ENTRIES = 50;

export function saveScanToHistory(entry: HistoryEntry): void {
  if (typeof window === "undefined") return;
  try {
    const existing = getScanHistory();
    const next = [entry, ...existing.filter(e => e.execution_id !== entry.execution_id)].slice(0, MAX_ENTRIES);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // localStorage can throw (private browsing, quota, disabled) — history
    // is a convenience layered on top of the scan, never a reason to block
    // or fail the scan itself.
  }
}

export function getScanHistory(): HistoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is HistoryEntry => e && typeof e.execution_id === "string" && typeof e.target_url === "string"
    );
  } catch {
    return [];
  }
}

export function clearScanHistory(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // best-effort
  }
}
