import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const execution_id = req.nextUrl.searchParams.get('execution_id');
  const apiBase = process.env.N8N_API_BASE!;
  const apiKey = process.env.N8N_API_KEY!;
  const headers = { 'X-N8N-API-KEY': apiKey, 'ngrok-skip-browser-warning': 'true' };

  const resp = await fetch(`${apiBase}/executions/${execution_id}?includeData=true`, { headers });

  if (!resp.ok) {
    return NextResponse.json({ error: `HTTP ${resp.status}` }, { status: resp.status });
  }

  const data = await resp.json();
  const status = data.status ?? 'unknown';

  let error_message: string | null = null;
  if (status === 'error') {
    error_message = data?.data?.resultData?.error?.message ?? null;
  }

  return NextResponse.json({
    execution_id,
    status,
    started_at: data.startedAt,
    stopped_at: data.stoppedAt,
    finished: ['success', 'error', 'crashed', 'canceled'].includes(status),
    error_message,
  });
}
