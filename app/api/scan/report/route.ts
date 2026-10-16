import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const execution_id = req.nextUrl.searchParams.get('execution_id');
  const apiBase = process.env.N8N_API_BASE!;
  const apiKey = process.env.N8N_API_KEY!;

  const resp = await fetch(`${apiBase}/executions/${execution_id}?includeData=true`, {
    headers: { 'X-N8N-API-KEY': apiKey },
  });

  if (!resp.ok) {
    return NextResponse.json({ error: `HTTP ${resp.status}` }, { status: resp.status });
  }

  const data = await resp.json();
  const status = data.status ?? 'unknown';

  if (status === 'running') {
    return NextResponse.json({ status: 'running', message: 'Still in progress.' });
  }

  const runData = data?.data?.resultData?.runData ?? {};

  // 'Parse Report To JSON' is the workflow's single authoritative
  // consolidation node. Every branch it can take (success / report-generation
  // failed / legacy-markdown-parse fallback / neither section found) sets its
  // own `reportStatus` and `requiresManualReview` flag, specifically so a
  // downstream consumer can tell a genuine result apart from a degraded one.
  //
  // This route used to skip straight past that signal and independently
  // scrape 'Report Generator' / 'Report Failure Fallback' / 'Compute
  // Regression' node output, picking whichever had the *longest* text found
  // anywhere in the execution's runData. 'Report Generator' is an AI step
  // that can run more than once per execution (once per finding/batch), so
  // when the run that matters failed (e.g. an upstream LLM rate limit) but an
  // unrelated/earlier run of the same node left a longer, well-formed-looking
  // string elsewhere in runData, that heuristic would silently serve the
  // unrelated text as if it were this execution's real report — masking a
  // real failure behind a plausible-looking but wrong result. See the
  // MCP-Sentinel audit notes: execution #499 had 'Parse Report To JSON'
  // recording reportStatus: 'FAILED' / confirmedVulnerabilities: null (the
  // Report Generator call hit an OpenAI/Groq rate limit), while the old
  // "longest candidate" scrape still returned a fully populated, unrelated
  // report for that same execution_id.
  //
  // Fix: read 'Parse Report To JSON' first and trust its own status. Only
  // treat the run as a genuine success when it says SUCCESS and does not
  // require manual review; otherwise surface the failure explicitly instead
  // of guessing at a substitute report.
  let parsed: Record<string, unknown> | null = null;
  for (const run of runData['Parse Report To JSON'] ?? []) {
    for (const item of run?.data?.main?.[0] ?? []) {
      if (item?.json) parsed = item.json as Record<string, unknown>;
    }
  }

  const tools = Array.isArray(parsed?.tools) ? (parsed!.tools as unknown[]) : [];
  const resources = Array.isArray(parsed?.resources) ? (parsed!.resources as unknown[]) : [];
  const prompts = Array.isArray(parsed?.prompts) ? (parsed!.prompts as unknown[]) : [];

  if (!parsed) {
    return NextResponse.json({ status, message: 'Report not found.', execution_id, tools, resources, prompts });
  }

  const reportStatus = (parsed.reportStatus as string | undefined) ?? 'UNKNOWN';
  const requiresManualReview = parsed.requiresManualReview === true;
  const rawOutput = typeof parsed.rawOutput === 'string' ? (parsed.rawOutput as string) : null;

  if (reportStatus === 'SUCCESS' && !requiresManualReview) {
    return NextResponse.json({
      status,
      report: rawOutput,
      confirmedVulnerabilities: parsed.confirmedVulnerabilities ?? null,
      unconfirmedLeads: parsed.unconfirmedLeads ?? null,
      counts: parsed.counts ?? null,
      tools,
      resources,
      prompts,
    });
  }

  // Report generation did not complete cleanly for this run (LLM error,
  // rate limit, or a legacy-markdown fallback that needs manual review).
  // Surface that plainly rather than picking a substitute report.
  return NextResponse.json({
    status,
    report: null,
    requiresManualReview: true,
    reportStatus,
    reportFailureError: parsed.reportFailureError ?? null,
    parsingStatus: parsed.parsingStatus ?? null,
    parsingNote: parsed.parsingNote ?? null,
    parsingFailureReason: parsed.parsingFailureReason ?? null,
    rawOutput,
    confirmedVulnerabilities: parsed.confirmedVulnerabilities ?? null,
    unconfirmedLeads: parsed.unconfirmedLeads ?? null,
    counts: parsed.counts ?? null,
    tools,
    resources,
    prompts,
  });
}
