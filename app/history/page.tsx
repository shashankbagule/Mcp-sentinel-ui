"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { getScanHistory, type HistoryEntry } from "../lib/scanHistory";
import { parseReport } from "../lib/parseReport";

type Status = "running" | "success" | "error" | "crashed" | "canceled" | "unknown";

interface ScanSummary extends HistoryEntry {
  status: Status;
  stopped_at: string | null;
  confirmed_count: number | null;
  unconfirmed_count: number | null;
  formatting_failed: boolean;
}

function StatusBadge({ status }: { status: Status }) {
  const map: Record<Status, { label: string; cls: string }> = {
    running: { label: "Running", cls: "text-blue-400 bg-blue-500/10 border-blue-500/30" },
    success: { label: "Completed", cls: "text-green-400 bg-green-500/10 border-green-500/30" },
    error: { label: "Failed", cls: "text-red-400 bg-red-500/10 border-red-500/30" },
    crashed: { label: "Crashed", cls: "text-red-400 bg-red-500/10 border-red-500/30" },
    canceled: { label: "Canceled", cls: "text-slate-400 bg-slate-500/10 border-slate-500/30" },
    unknown: { label: "Unknown", cls: "text-slate-400 bg-slate-500/10 border-slate-500/30" },
  };
  const { label, cls } = map[status] ?? map.unknown;
  return (
    <span className={`text-xs font-medium px-2.5 py-1 rounded-full border ${cls} flex items-center gap-1.5 whitespace-nowrap flex-shrink-0`}>
      {status === "running" && <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-pulse"></span>}
      {label}
    </span>
  );
}

function formatWhen(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function hostOf(url: string) {
  return url.replace(/^https?:\/\//, "").split("/")[0];
}

export default function HistoryPage() {
  const [scans, setScans] = useState<ScanSummary[] | null>(null);
  const [loading, setLoading] = useState(false);

  // History lives entirely in this browser's localStorage (app/lib/scanHistory.ts) —
  // there's no account system, so "your history" can only mean scans this
  // browser started. This just enriches each saved entry with its current
  // status/findings from the same APIs the scan detail page already polls.
  const load = useCallback(async () => {
    const entries = getScanHistory();
    if (entries.length === 0) {
      setScans([]);
      return;
    }

    setLoading(true);
    const enriched = await Promise.all(
      entries.map(async (entry): Promise<ScanSummary> => {
        const base: ScanSummary = {
          ...entry,
          status: "unknown",
          stopped_at: null,
          confirmed_count: null,
          unconfirmed_count: null,
          formatting_failed: false,
        };

        try {
          const statusRes = await fetch(`/api/scan/status?execution_id=${entry.execution_id}`);
          const statusData = await statusRes.json();
          base.status = (statusData.status as Status) ?? "unknown";
          base.stopped_at = statusData.stopped_at ?? null;

          if (statusData.finished && base.status === "success") {
            const reportRes = await fetch(`/api/scan/report?execution_id=${entry.execution_id}`);
            const reportData = await reportRes.json();
            if (typeof reportData.report === "string") {
              const parsed = parseReport(reportData.report);
              base.confirmed_count = parsed.confirmed.length;
              base.unconfirmed_count = parsed.unconfirmed.length;
              base.formatting_failed = parsed.formattingFailed;
            }
          }
        } catch {
          // A scan we can't currently reach (n8n offline, network blip)
          // should still show up as "saved" rather than vanish from the list.
        }

        return base;
      })
    );

    // Saved entries are stored oldest-first-pushed via saveScanToHistory
    // (newest unshifted to the front already), so no re-sort needed here.
    setScans(enriched);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="max-w-5xl mx-auto px-6 py-10">
      <div className="flex items-start justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white mb-1">Scan History</h1>
          <p className="text-slate-400 text-sm">Scans you&apos;ve run from this browser</p>
        </div>
        <div className="flex items-center gap-3">
          {scans && scans.length > 0 && (
            <button
              onClick={load}
              disabled={loading}
              className="text-sm text-slate-400 hover:text-white disabled:opacity-50 transition-colors"
            >
              {loading ? "Refreshing…" : "Refresh"}
            </button>
          )}
          <Link
            href="/"
            className="text-sm bg-gradient-to-r from-red-600 to-orange-600 hover:from-red-500 hover:to-orange-500 text-white font-medium px-4 py-2 rounded-xl transition-all whitespace-nowrap"
          >
            New scan
          </Link>
        </div>
      </div>

      {!scans && (
        <div className="bg-[#0d1225] border border-slate-800 rounded-2xl p-16 text-center text-slate-500">
          Loading scan history…
        </div>
      )}

      {scans && scans.length === 0 && (
        <div className="bg-[#0d1225] border border-slate-800 rounded-2xl p-16 text-center">
          <div className="text-4xl mb-3">🕓</div>
          <div className="font-semibold text-white mb-1">No scans yet</div>
          <div className="text-sm text-slate-500 mb-6">
            Run a scan and it&apos;ll show up here — history is saved to this browser only.
          </div>
          <Link href="/" className="text-sm text-red-400 hover:text-red-300">Start a scan →</Link>
        </div>
      )}

      {scans && scans.length > 0 && (
        <div className="space-y-3">
          {scans.map(scan => (
            <Link
              key={scan.execution_id}
              href={`/scan/${scan.execution_id}?target=${encodeURIComponent(scan.target_url)}`}
              className="block bg-[#0d1225] border border-slate-800 hover:border-slate-700 rounded-xl p-5 transition-colors"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="font-mono text-sm text-white truncate">{hostOf(scan.target_url)}</span>
                    {scan.dry_run && (
                      <span className="text-xs bg-slate-800 text-slate-400 px-2 py-0.5 rounded-full flex-shrink-0">Dry run</span>
                    )}
                  </div>
                  <div className="text-slate-500 text-xs font-mono truncate mb-2">{scan.target_url}</div>
                  <div className="flex items-center gap-4 text-xs text-slate-500">
                    <span>{formatWhen(scan.started_at)}</span>
                    {scan.status === "success" && !scan.formatting_failed && (
                      <>
                        <span className={scan.confirmed_count ? "text-red-400" : "text-green-400"}>
                          {scan.confirmed_count ?? 0} confirmed
                        </span>
                        <span className="text-yellow-500/80">{scan.unconfirmed_count ?? 0} needs review</span>
                      </>
                    )}
                    {scan.status === "success" && scan.formatting_failed && (
                      <span className="text-orange-400">⚠ report needs manual review</span>
                    )}
                  </div>
                </div>
                <StatusBadge status={scan.status} />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
