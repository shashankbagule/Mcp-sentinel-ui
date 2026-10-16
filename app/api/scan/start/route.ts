import { NextRequest, NextResponse } from 'next/server';
import { isAllowedTarget } from '../../../lib/allowedTargets';

export async function POST(req: NextRequest) {
  const { target_url, dry_run } = await req.json();

  // SECURITY_AUDIT.md finding #2: the n8n-side "Scope Guardrail" this
  // previously relied on exclusively does not actually block unlisted
  // targets (confirmed live, execution #529, 2026-10-03). Enforce the
  // allow-list here too, before the webhook is ever called, so this
  // route can't be used to point the live scanner at an arbitrary,
  // non-consented MCP server.
  if (typeof target_url !== 'string' || !isAllowedTarget(target_url)) {
    return NextResponse.json(
      { error: 'Target not authorized. This tool only scans pre-approved test targets.' },
      { status: 403 }
    );
  }

  const webhookUrl = process.env.N8N_WEBHOOK_URL!;
  const apiBase = process.env.N8N_API_BASE!;
  const webhookKey = process.env.N8N_WEBHOOK_KEY!;
  const apiKey = process.env.N8N_API_KEY!;
  const workflowId = process.env.N8N_WORKFLOW_ID!;

  const headers = { 'X-N8N-API-KEY': apiKey, 'ngrok-skip-browser-warning': 'true' };

  try {
    // Capture the most recent execution ID BEFORE firing
    let previousId: string | null = null;
    const beforeResp = await fetch(`${apiBase}/executions?workflowId=${workflowId}&limit=1`, { headers });
    if (beforeResp.ok) {
      const beforeData = await beforeResp.json();
      previousId = beforeData?.data?.[0]?.id ?? null;
    }

    const resp = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'X-API-Key': webhookKey, 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true' },
      body: JSON.stringify({ target_url, dryRun: dry_run ?? false }),
    });

    if (!resp.ok) {
      const bodyText = await resp.text();
      return NextResponse.json({ error: `Webhook failed: HTTP ${resp.status}`, detail: bodyText.slice(0,300) }, { status: 500 });
    }

    // Poll for either a running execution OR a new execution (any status, including fast-fail)
    let execution_id = 'unknown';
    for (let attempt = 0; attempt < 10; attempt++) {
      await new Promise(r => setTimeout(r, 1000));

      // First check specifically for running (normal case)
      const runResp = await fetch(`${apiBase}/executions?workflowId=${workflowId}&status=running`, { headers });
      if (runResp.ok) {
        const runData = await runResp.json();
        const running = runData?.data?.[0];
        if (running?.id) {
          execution_id = running.id;
          break;
        }
      }

      // Otherwise check if a new execution (any status) appeared — catches fast-fail rejections
      const latestResp = await fetch(`${apiBase}/executions?workflowId=${workflowId}&limit=1`, { headers });
      if (latestResp.ok) {
        const latestData = await latestResp.json();
        const latest = latestData?.data?.[0];
        if (latest?.id && latest.id !== previousId) {
          execution_id = latest.id;
          break;
        }
      }
    }

    return NextResponse.json({ status: 'started', execution_id, target_url });
  } catch (e: unknown) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
