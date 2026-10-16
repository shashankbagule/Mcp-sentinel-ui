// Shared with app/scan/[id]/page.tsx and app/history/page.tsx so a scan's
// confirmed/unconfirmed counts are computed exactly one way. The report API
// hands back a raw markdown report, not a findings count, so both pages that
// need "how many confirmed vulnerabilities" have to parse it the same way —
// otherwise history could show a different number than clicking into the
// scan does, for the same execution.

export interface Finding {
  score: number;
  text: string;
  severity: string;
  recommendation: string;
  confirmed: boolean;
}

export interface ParsedReport {
  confirmed: Finding[];
  unconfirmed: Finding[];
  raw: string;
  formattingFailed: boolean;
}

export function parseReport(markdown: string): ParsedReport {
  const confirmed: Finding[] = [];
  const unconfirmed: Finding[] = [];

  // The Report Generator LLM step can fail and fall back to a raw, untriaged
  // text dump that doesn't match the markdown-table format parsed below.
  // Detect that so callers never silently report "no vulnerabilities" when
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
