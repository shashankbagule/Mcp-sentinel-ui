"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";

type Status = "running" | "success" | "error" | "crashed" | "canceled" | "unknown";

interface McpTool {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
}

interface McpResource {
  uri: string;
  name: string;
  description: string;
  mimeType?: string;
}

interface McpPrompt {
  name: string;
  description: string;
  arguments?: { name: string; description: string; required?: boolean }[];
}

interface Finding {
  score: number;
  text: string;
  severity: string;
  recommendation: string;
  confirmed: boolean;
}

function parseSeverityColor(severity: string) {
  switch (severity.toLowerCase()) {
    case "critical": return "text-red-400 bg-red-500/10 border-red-500/30";
    case "high": return "text-orange-400 bg-orange-500/10 border-orange-500/30";
    case "medium": return "text-yellow-400 bg-yellow-500/10 border-yellow-500/30";
    case "low": return "text-blue-400 bg-blue-500/10 border-blue-500/30";
    default: return "text-slate-400 bg-slate-500/10 border-slate-500/30";
  }
}

function parseReport(markdown: string): { confirmed: Finding[]; unconfirmed: Finding[]; raw: string; formattingFailed: boolean } {
  const confirmed: Finding[] = [];
  const unconfirmed: Finding[] = [];

  // The Report Generator LLM step can fail and fall back to a raw, untriaged
  // text dump that doesn't match the markdown-table format parsed below.
  // Detect that so the UI never silently reports "no vulnerabilities" when
  // findings simply couldn't be parsed out of the fallback text.
  const formattingFailed = /AUTOMATED REPORT GENERATION FAILED/i.test(markdown);

  const confirmedSection = markdown.match(/## Confirmed Vulnerabilities\n([\s\S]*?)(?=## |$)/);
  const unconfirmedSection = markdown.match(/## Unconfirmed Findings[^\n]*\n([\s\S]*?)(?=## |$)/);

  function parseTable(section: string | undefined, isConfirmed: boolean) {
    if (!section) return;
    const rows = section.match(/\|[^|]+\|[^|]+\|[^|]+\|[^|]+\|/g) ?? [];
    for (const row of rows) {
      const cells = row.split("|").map(c => c.trim()).filter(Boolean);
      if (cells.length < 4 || cells[0] === "Score" || cells[0].startsWith("---")) continue;
      const score = parseFloat(cells[0]) || 0;
      const finding: Finding = {
        score,
        text: cells[1] ?? "",
        severity: cells[2] ?? "Unknown",
        recommendation: cells[3] ?? "",
        confirmed: isConfirmed,
      };
      if (finding.text && finding.text.length > 5) {
        if (isConfirmed) {
          confirmed.push(finding);
        } else {
          unconfirmed.push(finding);
        }
      }
    }
  }

  parseTable(confirmedSection?.[1], true);
  parseTable(unconfirmedSection?.[1], false);

  return { confirmed, unconfirmed, raw: markdown, formattingFailed };
}

export default function ScanPage() {
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const target = searchParams.get("target") ?? "";

  const [status, setStatus] = useState<Status>("running");
  const [startedAt, setStartedAt] = useState<string>("");
  const [stoppedAt, setStoppedAt] = useState<string>("");
  const [report, setReport] = useState<ReturnType<typeof parseReport> | null>(null);
  const [activeTab, setActiveTab] = useState<"findings" | "discovered" | "raw">("findings");
  const [tools, setTools] = useState<McpTool[]>([]);
  const [resources, setResources] = useState<McpResource[]>([]);
  const [prompts, setPrompts] = useState<McpPrompt[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const fetchReport = useCallback(async () => {
    const res = await fetch(`/api/scan/report?execution_id=${id}`);
    const data = await res.json();
    if (data.report) setReport(parseReport(data.report));
    if (data.tools) setTools(data.tools);
    if (data.resources) setResources(data.resources);
    if (data.prompts) setPrompts(data.prompts);
  }, [id]);

  const pollStatus = useCallback(async () => {
    const res = await fetch(`/api/scan/status?execution_id=${id}`);
    const data = await res.json();
    setStatus(data.status);
    if (data.error_message) setErrorMessage(data.error_message);
    if (data.started_at) setStartedAt(data.started_at);
    if (data.stopped_at) setStoppedAt(data.stopped_at);
    if (data.finished) await fetchReport();
    return data.finished;
  }, [id, fetchReport]);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;

    const start = async () => {
      const done = await pollStatus();
      if (!done) {
        interval = setInterval(async () => {
          const finished = await pollStatus();
          if (finished) clearInterval(interval);
        }, 15000);
      }
    };

    start();
    const timer = setInterval(() => setElapsed(e => e + 1), 1000);

    return () => { clearInterval(interval); clearInterval(timer); };
  }, [pollStatus]);

  const isRunning = status === "running";
  const isSuccess = status === "success";
  const confirmedCount = report?.confirmed.length ?? 0;
  const unconfirmedCount = report?.unconfirmed.length ?? 0;

  return (
    <div className="max-w-5xl mx-auto px-6 py-10">
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-3">
          <Link href="/" className="text-slate-500 hover:text-slate-300 text-sm transition-colors">← New scan</Link>
          <span className="text-slate-700">/</span>
          <span className="text-slate-400 text-sm font-mono">#{id}</span>
        </div>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white mb-1">Security Scan</h1>
            <p className="text-slate-400 font-mono text-sm truncate max-w-lg">{target}</p>
          </div>
          <StatusBadge status={status} />
        </div>
      </div>

      {isRunning && (
        <div className="bg-[#0d1225] border border-slate-800 rounded-2xl p-8 mb-6 text-center">
          <div className="flex items-center justify-center gap-3 mb-4">
            <div className="w-3 h-3 bg-blue-400 rounded-full animate-pulse"></div>
            <span className="text-white font-semibold">Scan in progress</span>
          </div>
          <p className="text-slate-400 text-sm mb-6">Running security checks — this takes 3–5 minutes</p>
          <div className="w-full bg-slate-800 rounded-full h-2 mb-3">
            <div
              className="bg-gradient-to-r from-blue-500 to-purple-500 h-2 rounded-full transition-all duration-1000"
              style={{ width: `${Math.min((elapsed / 300) * 100, 95)}%` }}
            />
          </div>
          <p className="text-slate-500 text-xs">{Math.floor(elapsed / 60)}m {elapsed % 60}s elapsed · polling every 15s</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-8 text-left">
            {[
              "Auth bypass checks",
              "Prompt injection tests",
              "Tool poisoning analysis",
              "Resource exposure audit",
            ].map((step, i) => (
              <div key={step} className={`flex items-center gap-2 text-xs ${elapsed > i * 45 ? "text-green-400" : "text-slate-600"}`}>
                <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  {elapsed > i * 45
                    ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    : <circle cx="12" cy="12" r="9" strokeWidth={2} />}
                </svg>
                {step}
              </div>
            ))}
          </div>
        </div>
      )}

      {isSuccess && report && (
        <>
          {report.formattingFailed && <ReportFormattingWarning />}

          <div className="grid grid-cols-3 gap-4 mb-6">
            <StatCard label="Confirmed" value={confirmedCount} color="red" />
            <StatCard label="Needs Review" value={unconfirmedCount} color="yellow" />
            <StatCard
              label="Highest Severity"
              value={
                report.formattingFailed && confirmedCount === 0
                  ? "Unknown"
                  : (report.confirmed[0]?.severity ?? (confirmedCount === 0 ? "None" : "–"))
              }
              color={
                report.formattingFailed && confirmedCount === 0
                  ? "yellow"
                  : confirmedCount > 0 ? "red" : "green"
              }
              isText
            />
          </div>

          <div className="flex gap-1 mb-4 bg-slate-900 p-1 rounded-xl w-fit">
            {(["findings", "discovered", "raw"] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors capitalize ${activeTab === tab ? "bg-slate-700 text-white" : "text-slate-400 hover:text-white"}`}
              >
                {tab === "findings" ? `Findings (${confirmedCount + unconfirmedCount})` : tab === "discovered" ? `Discovered (${tools.length + resources.length + prompts.length})` : "Raw Report"}
              </button>
            ))}
          </div>

          {activeTab === "findings" && (
            <div className="space-y-4">
              {confirmedCount > 0 && (
                <section>
                  <h2 className="text-red-400 font-semibold text-sm uppercase tracking-wider mb-3 flex items-center gap-2">
                    <span className="w-2 h-2 bg-red-400 rounded-full"></span>
                    Confirmed Vulnerabilities
                  </h2>
                  {report.confirmed.map((f, i) => <FindingCard key={i} finding={f} />)}
                </section>
              )}
              {unconfirmedCount > 0 && (
                <section>
                  <h2 className="text-yellow-400 font-semibold text-sm uppercase tracking-wider mb-3 flex items-center gap-2">
                    <span className="w-2 h-2 bg-yellow-400 rounded-full"></span>
                    Unconfirmed — Manual Verification Required
                  </h2>
                  {report.unconfirmed.map((f, i) => <FindingCard key={i} finding={f} />)}
                </section>
              )}
              {confirmedCount === 0 && unconfirmedCount === 0 && (
                report.formattingFailed ? (
                  <div className="text-center py-16 text-slate-500">
                    <div className="text-4xl mb-3">⚠️</div>
                    <div className="font-semibold text-orange-400 mb-1">Findings could not be parsed</div>
                    <div className="text-sm max-w-md mx-auto">
                      Report generation failed and fell back to a raw format this page can&apos;t parse into a findings list.
                      This is <span className="font-semibold text-white">not</span> a clean scan — check the Raw Report tab.
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-16 text-slate-500">
                    <div className="text-4xl mb-3">✅</div>
                    <div className="font-semibold text-white mb-1">No vulnerabilities found</div>
                    <div className="text-sm">This target passed all security checks</div>
                  </div>
                )
              )}
            </div>
          )}


          {activeTab === "discovered" && (
            <div className="space-y-6">
              {tools.length > 0 && (
                <section>
                  <h2 className="text-blue-400 font-semibold text-sm uppercase tracking-wider mb-3 flex items-center gap-2">
                    <span className="w-2 h-2 bg-blue-400 rounded-full"></span>
                    Tools ({tools.length})
                  </h2>
                  <div className="space-y-3">
                    {tools.map((t, i) => (
                      <div key={i} className="bg-[#0d1225] border border-slate-800 rounded-xl p-4">
                        <div className="font-mono text-sm text-white mb-1">{t.name}</div>
                        <div className="text-slate-400 text-sm">{t.description}</div>
                      </div>
                    ))}
                  </div>
                </section>
              )}
              {resources.length > 0 && (
                <section>
                  <h2 className="text-purple-400 font-semibold text-sm uppercase tracking-wider mb-3 flex items-center gap-2">
                    <span className="w-2 h-2 bg-purple-400 rounded-full"></span>
                    Resources ({resources.length})
                  </h2>
                  <div className="space-y-3">
                    {resources.map((r, i) => (
                      <div key={i} className="bg-[#0d1225] border border-slate-800 rounded-xl p-4">
                        <div className="font-mono text-sm text-white mb-1">{r.uri}</div>
                        <div className="text-slate-300 text-sm mb-1">{r.name}</div>
                        <div className="text-slate-500 text-xs">{r.description}</div>
                      </div>
                    ))}
                  </div>
                </section>
              )}
              {prompts.length > 0 && (
                <section>
                  <h2 className="text-green-400 font-semibold text-sm uppercase tracking-wider mb-3 flex items-center gap-2">
                    <span className="w-2 h-2 bg-green-400 rounded-full"></span>
                    Prompts ({prompts.length})
                  </h2>
                  <div className="space-y-3">
                    {prompts.map((p, i) => (
                      <div key={i} className="bg-[#0d1225] border border-slate-800 rounded-xl p-4">
                        <div className="font-mono text-sm text-white mb-1">{p.name}</div>
                        <div className="text-slate-400 text-sm">{p.description}</div>
                      </div>
                    ))}
                  </div>
                </section>
              )}
              {tools.length === 0 && resources.length === 0 && prompts.length === 0 && (
                <div className="text-center py-16 text-slate-500">No discovery data available for this scan.</div>
              )}
            </div>
          )}

          {activeTab === "raw" && (
            <div className="bg-[#0d1225] border border-slate-800 rounded-2xl p-6">
              <pre className="text-slate-300 text-xs font-mono whitespace-pre-wrap leading-relaxed overflow-auto max-h-[600px]">
                {report.raw}
              </pre>
            </div>
          )}
        </>
      )}

      {(status === "error" || status === "crashed") && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-2xl p-8 text-center">
          <div className="text-4xl mb-3">
            {errorMessage?.includes("not an authorized test target") ? "🚫" : "❌"}
          </div>
          {errorMessage?.includes("not an authorized test target") ? (
            <>
              <div className="text-red-400 font-semibold mb-2">Target not authorized</div>
              <div className="text-slate-400 text-sm max-w-md mx-auto">
                This URL isn&apos;t on the approved scan list. MCP-Sentinel only scans pre-authorized targets to prevent misuse.
                Contact the site owner to add your target.
              </div>
            </>
          ) : (
            <>
              <div className="text-red-400 font-semibold mb-2">Scan failed</div>
              <div className="text-slate-400 text-sm">{errorMessage || `Check execution #${id} for details`}</div>
            </>
          )}
          <Link href="/" className="mt-4 inline-block text-sm text-red-400 hover:text-red-300">Try again →</Link>
        </div>
      )}

      {(startedAt || stoppedAt) && (
        <div className="mt-6 text-xs text-slate-600 flex gap-4">
          {startedAt && <span>Started: {new Date(startedAt).toLocaleTimeString()}</span>}
          {stoppedAt && <span>Finished: {new Date(stoppedAt).toLocaleTimeString()}</span>}
          {startedAt && stoppedAt && (
            <span>Duration: {Math.round((new Date(stoppedAt).getTime() - new Date(startedAt).getTime()) / 1000)}s</span>
          )}
        </div>
      )}
    </div>
  );
}

function ReportFormattingWarning() {
  return (
    <div className="bg-orange-500/10 border border-orange-500/30 rounded-2xl p-5 mb-6 flex items-start gap-3">
      <span className="text-2xl leading-none">⚠️</span>
      <div>
        <div className="text-orange-400 font-semibold mb-1">Report formatting failed</div>
        <div className="text-slate-300 text-sm">
          The AI report writer failed to format this scan&apos;s findings, so the summary counts above may be incomplete or wrong.
          Check the <span className="font-medium text-white">Raw Report</span> tab for the full untriaged output before trusting a &quot;no vulnerabilities&quot; result.
        </div>
      </div>
    </div>
  );
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
    <span className={`text-xs font-medium px-3 py-1 rounded-full border ${cls} flex items-center gap-1.5 whitespace-nowrap`}>
      {status === "running" && <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-pulse"></span>}
      {label}
    </span>
  );
}

function StatCard({ label, value, color, isText }: { label: string; value: string | number; color: string; isText?: boolean }) {
  const colorMap: Record<string, string> = {
    red: "text-red-400",
    yellow: "text-yellow-400",
    green: "text-green-400",
    blue: "text-blue-400",
  };
  return (
    <div className="bg-[#0d1225] border border-slate-800 rounded-xl p-5">
      <div className="text-slate-500 text-xs uppercase tracking-wider mb-2">{label}</div>
      <div className={`font-bold ${isText ? "text-2xl" : "text-3xl"} ${colorMap[color] ?? "text-white"}`}>{value}</div>
    </div>
  );
}

function FindingCard({ finding }: { finding: Finding }) {
  const [expanded, setExpanded] = useState(false);
  const severityClass = parseSeverityColor(finding.severity);

  return (
    <div className="bg-[#0d1225] border border-slate-800 hover:border-slate-700 rounded-xl p-5 transition-colors cursor-pointer" onClick={() => setExpanded(!expanded)}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <span className={`text-xs font-medium px-2 py-0.5 rounded border ${severityClass}`}>{finding.severity}</span>
            {finding.score > 0 && (
              <span className="text-xs text-slate-500">Score: {finding.score}/10</span>
            )}
          </div>
          <p className="text-slate-200 text-sm leading-relaxed line-clamp-2">{finding.text}</p>
        </div>
        <svg className={`w-4 h-4 text-slate-500 flex-shrink-0 mt-1 transition-transform ${expanded ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </div>
      {expanded && finding.recommendation && (
        <div className="mt-4 pt-4 border-t border-slate-800">
          <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Recommendation</p>
          <p className="text-slate-300 text-sm">{finding.recommendation}</p>
        </div>
      )}
    </div>
  );
}
