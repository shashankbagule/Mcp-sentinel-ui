import { NextResponse } from 'next/server';

// MCP-Sentinel has no database of its own — n8n's own execution store is the
// only place a past scan's data lives, so History reads from there directly
// (same source `report/route.ts` and `start/route.ts` already trust) rather
// than standing up a separate persistence layer for what is, in effect, a
// cache of data n8n already keeps.
//
// Note: this deliberately does NOT call `${apiBase}/executions` with both
// `workflowId` and `includeData=true` at once — that combination is a known
// n8n bug that can throw "Invalid string length" once execution payloads get
// large (see community.n8n.io/t/147975), which would take down the whole
// history list instead of just one row. Instead: a cheap list call for the
// ids, then per-execution `includeData=true` fetches (the same singular
// endpoint report/route.ts already uses) in parallel, each fenced off so one
// bad execution can't sink the rest.

const HISTORY_LIMIT = 12;

interface ScanSummary {
  execution_id: string;
  status: string;
  started_at: string | null;
  stopped_at: string | null;
  target_url: string | null;
  dry_run: boolean;
  confirmed_count: number | null;
  unconfirmed_count: number | null;
  requires_manual_review: boolean;
}

export async function GET() {
  const apiBase = process.env.N8N_API_BASE!;
  const apiKey = process.env.N8N_API_KEY!;
  const workflowId = process.env.N8N_WORKFLOW_ID!;
  const headers = { 'X-N8N-API-KEY': apiKey, 'ngrok-skip-browser-warning': 'true' };

  const listResp = await fetch(
    `${apiBase}/executions?workflowId=${workflowId}&limit=${HISTORY_LIMIT}`,
    { headers }
  );

  if (!listResp.ok) {
    return NextResponse.json({ error: `HTTP ${listResp.status}` }, { status: listResp.status });
  }

  const listData = await listResp.json();
  const summaries = Array.isArray(listData?.data) ? listData.data : [];

  const scans: ScanSummary[] = await Promise.all(
    summaries.map(async (exec: Record<string, unknown>): Promise<ScanSummary> => {
      const base: ScanSummary = {
        execution_id: String(exec.id),
        status: (exec.status as string) ?? 'unknown',
        started_at: (exec.startedAt as string) ?? null,
        stopped_at: (exec.stoppedAt as string) ?? null,
        target_url: null,
        dry_run: false,
        confirmed_count: null,
        unconfirmed_count: null,
        requires_manual_review: false,
      };

      // A still-running execution has no report to summarize yet, and
      // fetching its full data now would just race the same in-progress run
      // '/scan/[id]' is already polling — skip straight to the cheap summary.
      if (base.status === 'running') return base;

      try {
        const detailResp = await fetch(`${apiBase}/executions/${base.execution_id}?includeData=true`, { headers });
        if (!detailResp.ok) return base;
        const detail = await detailResp.json();
        const nodeRuns = (detail?.data?.resultData?.runData ?? {}) as Record<string, unknown[]>;

        const targetUrl = extractField(nodeRuns, 'target_url');
        const dryRun = extractField(nodeRuns, 'dryRun');

        // Trust 'Parse Report To JSON' the same way report/route.ts does, so
        // a run whose report generation failed shows up as such instead of a
        // guessed/blank count.
        let parsed: Record<string, unknown> | null = null;
        for (const run of (nodeRuns['Parse Report To JSON'] ?? []) as Record<string, unknown>[]) {
          const items = ((run?.data as Record<string, unknown>)?.main as unknown[][] | undefined)?.[0] ?? [];
          for (const item of items as Record<string, unknown>[]) {
            if (item?.json) parsed = item.json as Record<string, unknown>;
          }
        }
        const reportOk = !!parsed && parsed.reportStatus === 'SUCCESS' && parsed.requiresManualReview !== true;
        const counts = reportOk ? (parsed!.counts as Record<string, number> | undefined) : undefined;

        return {
          ...base,
          target_url: typeof targetUrl === 'string' ? targetUrl : null,
          dry_run: dryRun === true,
          confirmed_count: reportOk ? counts?.confirmed ?? null : null,
          unconfirmed_count: reportOk ? counts?.unconfirmed ?? null : null,
          requires_manual_review: !!parsed && parsed.requiresManualReview === true,
        };
      } catch {
        // One execution's detail fetch failing (timeout, malformed payload)
        // shouldn't blank out the rest of the list.
        return base;
      }
    })
  );

  return NextResponse.json({ scans });
}

// The webhook trigger node's name isn't fixed in code anywhere else in this
// app, so rather than hard-code it here too, walk every node's run data and
// pull the first item whose body carries the field we want.
function extractField(nodeRuns: Record<string, unknown>, field: string): unknown {
  for (const key of Object.keys(nodeRuns)) {
    const runs = nodeRuns[key];
    if (!Array.isArray(runs)) continue;
    for (const run of runs as Record<string, unknown>[]) {
      const items = ((run?.data as Record<string, unknown>)?.main as unknown[][] | undefined)?.[0] ?? [];
      for (const item of items as Record<string, unknown>[]) {
        const json = item?.json as Record<string, unknown> | undefined;
        const body = (json?.body as Record<string, unknown> | undefined) ?? json;
        if (body && typeof body === 'object' && field in body) return body[field];
      }
    }
  }
  return null;
}
