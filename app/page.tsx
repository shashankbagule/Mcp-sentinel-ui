"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveScanToHistory } from "./lib/scanHistory";
import { ALLOWED_TARGETS } from "./lib/allowedTargets";

export default function HomePage() {
  const router = useRouter();
  const [target, setTarget] = useState("");
  const [dryRun, setDryRun] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleScan(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/scan/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target_url: target, dry_run: dryRun }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      saveScanToHistory({
        execution_id: data.execution_id,
        target_url: target,
        dry_run: dryRun,
        started_at: new Date().toISOString(),
      });
      router.push(`/scan/${data.execution_id}?target=${encodeURIComponent(target)}`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      setLoading(false);
    }
  }

  return (
    <div className="max-w-4xl mx-auto px-6 py-16">
      <div className="text-center mb-14">
        <div className="inline-flex items-center gap-2 bg-red-500/10 border border-red-500/20 text-red-400 text-xs px-3 py-1.5 rounded-full mb-6">
          <span className="w-1.5 h-1.5 bg-red-400 rounded-full animate-pulse"></span>
          Automated MCP Security Testing
        </div>
        <h1 className="text-5xl font-bold text-white mb-4 tracking-tight">
          Pentest your{" "}
          <span className="bg-gradient-to-r from-red-400 to-orange-400 bg-clip-text text-transparent">
            MCP Server
          </span>
        </h1>
        <p className="text-slate-400 text-lg max-w-xl mx-auto">
          MCP-Sentinel automatically tests MCP servers for prompt injection, auth bypass,
          tool poisoning, resource exposure, and more.
        </p>
      </div>

      <div className="bg-[#0d1225] border border-slate-800 rounded-2xl p-8 shadow-2xl">
        <form onSubmit={handleScan} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Target MCP Server URL
            </label>
            <input
              type="url"
              value={target}
              onChange={e => setTarget(e.target.value)}
              placeholder="https://your-mcp-server.com/mcp"
              required
              className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition-colors"
            />
            <div className="mt-3 flex flex-wrap gap-2">
              {ALLOWED_TARGETS.slice(0, 3).map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTarget(t)}
                  className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 px-3 py-1 rounded-lg transition-colors truncate max-w-[240px]"
                >
                  {t.replace("https://", "").replace("http://", "").split("/")[0]}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setDryRun(!dryRun)}
              className={`relative w-11 h-6 rounded-full transition-colors ${dryRun ? "bg-orange-500" : "bg-slate-700"}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${dryRun ? "translate-x-5" : ""}`} />
            </button>
            <div>
              <span className="text-sm font-medium text-slate-300">Dry run</span>
              <p className="text-xs text-slate-500">Passive checks only — no live tool invocations</p>
            </div>
          </div>

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-400 rounded-xl px-4 py-3 text-sm">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-gradient-to-r from-red-600 to-orange-600 hover:from-red-500 hover:to-orange-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3.5 rounded-xl transition-all shadow-lg shadow-red-900/30 flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Starting scan...
              </>
            ) : (
              <>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
                Start Security Scan
              </>
            )}
          </button>
        </form>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-10">
        {[
          { icon: "💉", label: "Prompt Injection", desc: "Tests for hidden payloads in tool descriptions" },
          { icon: "🔐", label: "Auth Bypass", desc: "Checks session validation and spoofing" },
          { icon: "☠️", label: "Tool Poisoning", desc: "Detects misleading safety claims" },
          { icon: "📂", label: "Resource Exposure", desc: "Audits exposed sensitive URIs" },
        ].map(f => (
          <div key={f.label} className="bg-[#0d1225] border border-slate-800 rounded-xl p-4 hover:border-slate-700 transition-colors">
            <div className="text-2xl mb-2">{f.icon}</div>
            <div className="text-sm font-semibold text-white mb-1">{f.label}</div>
            <div className="text-xs text-slate-500">{f.desc}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
