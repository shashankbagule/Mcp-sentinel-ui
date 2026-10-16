# MCP-Sentinel UI — Security Audit

**Scope:** `app/` and `app/lib/` (Next.js routes, API routes, pages) in `mcp-sentinel-ui`.
**Explicitly excluded:** `node_modules/`, `.next/`, `damn-vulnerable-MCP-server/` (a deliberately vulnerable test target, not app code), `package-lock.json`.
**Standard applied:** a finding only counts if there's a concrete exploit path or failure mode — not a bare "best practice" citation. Style nits are not reported.

---

## Findings (most severe first)

### 1. [HIGH] Broken access control on `/api/scan/report` and `/api/scan/status` — any anonymous visitor can read any execution on the n8n instance, not just this workflow's

**Files:** `app/api/scan/report/route.ts:9`, `app/api/scan/status/route.ts:9`

Both routes do:
```ts
const resp = await fetch(`${apiBase}/executions/${execution_id}?includeData=true`, { headers });
```
`execution_id` comes straight from the client's query string, and neither route checks that the returned execution's `workflowId` matches `process.env.N8N_WORKFLOW_ID`. The n8n API key used here is (per n8n's own model) typically instance-scoped, not workflow-scoped — so if this n8n instance runs *any* other workflow (personal automations, other projects), its execution data is reachable through this public, unauthenticated endpoint.

**Exploit path:** n8n execution IDs are sequential integers — the codebase's own comments reference specific ones (`execution #528`, `execution #499`). An anonymous visitor can enumerate `GET /api/scan/report?execution_id=1`, `2`, `3`, … and read the full `runData` (via `report/route.ts`'s own parsing) of every execution ever run on that n8n instance, not just MCP-Sentinel scans. `report/route.ts` returns the richest data (`rawOutput`, `confirmedVulnerabilities`, tool/resource/prompt lists); `status/route.ts` leaks less (status + timestamps + error message) but still confirms execution existence and timing for IDs outside this workflow.

**Fix:** After fetching, verify `data.workflowId === process.env.N8N_WORKFLOW_ID` before returning anything; return 404 otherwise. Same check belongs in `history/route.ts`, which currently avoids this only because its ids come from an already-scoped list call — it should still defend in depth.

---

### 2. [RETRACTED — invalid test] "Allow-list bypass" claim from the live test on 2026-10-03 does not hold

**What I originally claimed:** that submitting `http://127.0.0.1:3002/mcp` (absent from the client-side `ALLOWED_TARGETS` list) and having the scan run to completion proved the n8n Scope Guardrail doesn't enforce authorization.

**Why that's wrong:** per Shashank, the real operating model is manual — a new target has to be added to the guardrail's allowlist *inside n8n* before it can be scanned, and `127.0.0.1:3002` had already been added there. I didn't know that when I ran the test, and I didn't ask before concluding the guardrail was broken. A scan completing against a target that genuinely *was* authorized (just not reflected in the client-side suggestion list I was treating as the full policy) is the guardrail working correctly, not a bypass.

**The actual mistake, named plainly:** I treated `page.tsx`'s `ALLOWED_TARGETS` array (8 hardcoded URLs, meant as UI suggestion chips) as if it were the complete, authoritative policy, and ran a test designed to distinguish "guardrail works" from "guardrail broken" without controlling for the one confound that mattered — whether my test target had already been authorized through the *real* mechanism (manual addition in n8n), which I have no visibility into and never asked about before drawing a conclusion. That's a **context gap**, not a workspace or instructions problem: the live-test *capability* worked exactly as intended: it surfaced a wrong assumption fast. The error was concluding from one data point without first ruling out the obvious alternative explanation.

**What's still actually unknown:** whether the guardrail would reject a target that has genuinely never been added to it. I have not tested that, and shouldn't claim either way without a target I can confirm with Shashank was never added.

**Status of the code change made in response to the retracted claim:** `app/lib/allowedTargets.ts` + the check added to `start/route.ts` are **still in the codebase but their justification needs re-examination** — see the note at the end of this document. If the real workflow is "add a target to n8n's guardrail when you want to test it," a second, independent, hardcoded 8-URL list in the Next.js app will go stale every time a target is added to n8n but not mirrored here — rejecting legitimate scans with a false "not authorized" instead of adding any real protection the n8n side wasn't already providing.

---

### 2b. [HIGH] `/api/scan/start` additionally has no CSRF protection — so even once the allow-list above is fixed, a cross-site page could still trigger scans against *authorized* targets without consent

**Files:** `app/api/scan/start/route.ts`, `app/page.tsx:7-16`

`/api/scan/start` is a state-changing POST with no CSRF token and no `Origin`/`Referer` check. It accepts `application/json`, which normally requires a CORS preflight — but a request can still be sent without one using `enctype="text/plain"` on a cross-site auto-submitting form (a well-documented technique for JSON APIs that skip origin checks), since `text/plain` doesn't trigger a preflight and this route's `req.json()` will still parse a body shaped like valid JSON.

Separately, `ALLOWED_TARGETS` in `page.tsx` is shipped to every visitor's browser — it's a *client-side convenience list*, not a server-side check. `start/route.ts` forwards whatever `target_url` it's given straight to the n8n webhook with no validation of its own; the only gate is n8n's "Scope Guardrail" node, which this codebase doesn't contain (I could not inspect it — see Unverified, below).

**Exploit path (plausible, not confirmed live — see below):** an attacker hosts a page with a hidden auto-submitting form targeting `/api/scan/start` with one of the publicly-known allowed targets (read straight out of the shipped JS bundle). Anyone who opens that page silently triggers a real scan — each one consuming an n8n execution and, per the README, LLM calls for report generation. Repeated visits become a resource/cost-abuse vector against infrastructure the attacker never needed credentials for.

**Fix:** add same-site/Origin validation on `start/route.ts` (reject requests whose `Origin`/`Referer` isn't the site's own origin), and add basic rate limiting (even an in-memory or edge-config limiter) per IP on this route.

---

### 3. [MEDIUM] No rate limiting on any `/api/scan/*` route

**Files:** `app/api/scan/start/route.ts`, `report/route.ts`, `status/route.ts`, `history/route.ts`

Independent of #2's CSRF angle, there is nothing stopping a single client from calling `/api/scan/start` in a tight loop against an authorized target. `start/route.ts` already does up to 10 sequential polling requests to n8n per call (`for (let attempt = 0; attempt < 10...)`), so each hit is not free even before the scan itself runs. This is a direct cost/availability exposure for a publicly reachable endpoint.

**Fix:** rate-limit by IP (even a simple sliding window) at minimum on `start`; consider a shared budget since Vercel functions don't share memory across instances by default (would need an external store or Vercel's own rate-limit primitive).

---

### 4. [LOW] Internal network addresses shipped in client-side JS

**File:** `app/page.tsx:7-16`

`ALLOWED_TARGETS` includes private/internal addresses (`172.17.0.1`, `127.0.0.1`, `192.168.0.103` on several ports). These ship in the client JS bundle to every visitor. On their own they're low-value (no secret, and likely your own lab machine), but combined with #2 they're the exact payload an attacker would replay. Minor information disclosure about your internal lab topology either way.

**Fix:** move the server-authoritative allow-list check to `start/route.ts` itself (defense in depth alongside n8n's own guardrail), and consider not shipping internal lab addresses in a public bundle at all — keep only the genuinely public demo targets client-side.

---

### 5. [LOW] Unused `/api/scan/history` route left live after the History feature was redesigned

**File:** `app/api/scan/history/route.ts`

This route was built for an earlier "list every execution on the workflow" design, then superseded by the localStorage-based per-browser history (`app/lib/scanHistory.ts`, `app/history/page.tsx`) — no page calls it anymore. It's not independently exploitable (it does scope its list call by `workflowId`), but it's dead attack surface: an extra endpoint making extra n8n API calls that nothing in the product needs. Should be deleted, or explicitly repurposed, rather than left live and unreferenced.

---

## What I could not verify (no shell access on the target machine — file read/write only)

- **n8n's "Scope Guardrail" node — still actually unverified, after getting this wrong once already.** First pass: I assumed it existed and worked, on the strength of the README's description and the UI's dedicated error path, without testing it. Second pass: I ran a live test and claimed it was *disproven* — wrong, because the target I used had already been manually authorized in n8n and I never asked whether that was the case before concluding. Net state: I still don't know whether the guardrail would correctly reject a target that was genuinely never added to it. Testing that for real needs a target Shashank can confirm was never added — not for me to guess at.
- **Whether the n8n API key (`N8N_API_KEY`) is scoped to this one workflow or the whole instance.** Finding #1's severity still depends on this, and I still haven't verified it live — doing so safely would mean you checking your own n8n instance's settings, not me enumerating other executions (I attempted a minimal check — a single known-safe ID — and the safety system correctly stopped me from going further, since probing unknown execution IDs for data is scouting/exfiltration behavior regardless of whose infrastructure it is).
- **Git history for `.env.local` or other secrets.** Current `.gitignore` correctly excludes `.env*`, but I had no shell to run `git log --all -- .env.local` and confirm nothing was committed before that rule existed, or in an earlier commit.
- **Live exploitation of #2b's CSRF path.** Not tested — lower priority now that #2 (the bigger issue) is confirmed by a simpler, non-adversarial test.
