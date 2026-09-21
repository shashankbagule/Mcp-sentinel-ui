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
  let report: string | null = null;

  // A node can execute more than once in a single workflow run (e.g. when
  // upstream data arrives as multiple items instead of one merged item),
  // and each execution shows up as its own entry in runData[nodeName]. When
  // that happens for 'Report Generator', the AI step runs independently per
  // item and can produce a full, well-formed but empty/degenerate report
  // ("0 confirmed, 0 unconfirmed") for a near-empty batch alongside the real
  // report for the batch that actually has findings. Taking the *first*
  // candidate over 100 chars (the old behavior) can silently pick the empty
  // one if it happens to run first. Instead, collect every candidate for a
  // node name and take the longest — a genuine findings report is always
  // substantially longer than a "no findings" one.
  for (const nodeName of ['Report Generator', 'Report Failure Fallback', 'Compute Regression']) {
    const candidates: string[] = [];
    for (const run of runData[nodeName] ?? []) {
      for (const item of run?.data?.main?.[0] ?? []) {
        const candidate = item?.json?.output ?? '';
        if (candidate && candidate.length > 100) {
          candidates.push(candidate);
        }
      }
    }
    if (candidates.length > 0) {
      report = candidates.reduce((best, c) => (c.length > best.length ? c : best));
      break;
    }
  }

  if (report) {
    return NextResponse.json({ status, report });
  }
  return NextResponse.json({ status, message: 'Report not found.', execution_id });
}
