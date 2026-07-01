import { evaluateChecklist, groupChecklistByCategory } from "./checklist-taxonomy.js";

export const visualPlanToSpec = (visualPlan = {}) =>
  [
    visualPlan.prompt ? `Prompt: ${visualPlan.prompt}` : visualPlan.promptOrSpec || "",
    visualPlan.negativePrompt ? `Negative prompt: ${visualPlan.negativePrompt}` : "",
    visualPlan.altText ? `Alt text: ${visualPlan.altText}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

const checklistLabel = (item) => {
  const normalized = typeof item === "string" ? { item } : item;
  return normalized.item || normalized.text || normalized.label || String(item);
};

const blocksToMarkdown = (blocks = []) =>
  blocks
    .map((block) => {
      const type = block.type || "section";
      if (type === "hero") {
        return `## Hero\n\n### ${block.heading || ""}\n\n${block.subheading || ""}\n\n${block.body || ""}\n\nPrimary CTA: ${block.primaryCta || ""}\nSecondary CTA: ${block.secondaryCta || ""}`;
      }
      if (type === "steps") {
        return `## How it works\n\n${(block.items || []).map((item) => `${item.step}. **${item.title}** — ${item.body}`).join("\n")}`;
      }
      if (type === "features" || type === "useCases" || type === "comparison") {
        const title = type === "features" ? "Features" : type === "useCases" ? "Use cases" : "Comparison";
        return `## ${title}\n\n${(block.items || [])
          .map((item) => `- **${item.title || item.label || ""}**: ${item.body || item.summary || ""}`)
          .join("\n")}`;
      }
      if (type === "faq") {
        return `## FAQ\n\n${(block.items || []).map((item) => `- ${item.question} — ${item.answer}`).join("\n")}`;
      }
      if (type === "cta") {
        return `## CTA\n\n${block.heading || ""}\n\n${block.body || ""}\n\nButton: ${block.buttonText || ""}`;
      }
      return `## ${block.heading || type}\n\n${block.body || ""}`;
    })
    .join("\n\n");

const formatMetricNumber = (value) => {
  const number = Number(value || 0);
  return Number.isFinite(number) ? String(Math.round(number)) : "0";
};

const formatMetricPercent = (value) => {
  const number = Number(value || 0);
  return Number.isFinite(number) ? `${(number * 100).toFixed(1)}%` : "0.0%";
};

const formatPosition = (value) => {
  const number = Number(value || 0);
  return Number.isFinite(number) && number > 0 ? number.toFixed(1) : "n/a";
};

const opportunityToMarkdown = (item) => {
  const metrics = item.metrics || {};
  const target = item.page || (item.urls || []).join(", ") || "No suitable landing page";
  const actions = (item.recommendedActions || []).map((action) => `  - ${action}`).join("\n");
  const query = item.query ? `Query: ${item.query}\n` : "";
  return `- [${item.priority || "medium"}] ${item.type}: ${item.title}
  ${query}  Target: ${target}
  Metrics: ${formatMetricNumber(metrics.impressions)} impressions, ${formatMetricNumber(metrics.clicks)} clicks, ${formatMetricPercent(metrics.ctr)} CTR, avg position ${formatPosition(metrics.position)}
  Reason: ${item.reason || ""}
${actions || "  - Review before publishing."}`;
};

const gscPerformanceToMarkdown = (performance = {}) => {
  const dateRange = performance.dateRange || {};
  const range =
    dateRange.startDate && dateRange.endDate
      ? `${dateRange.startDate} to ${dateRange.endDate}`
      : "No date range loaded";
  return `- Status: ${performance.status || "not-connected"}
- Property: ${performance.propertyUrl || "not selected"}
- Date range: ${range}
- Rows: ${formatMetricNumber(performance.rowCount)}
- Totals: ${formatMetricNumber(performance.totalImpressions)} impressions, ${formatMetricNumber(performance.totalClicks)} clicks, ${formatMetricPercent(performance.averageCtr)} average CTR, avg position ${formatPosition(performance.averagePosition)}
${(performance.limitations || []).map((item) => `- Limitation: ${item}`).join("\n")}`;
};

export const draftToMarkdown = (draft) => {
  const hasBlocks = Array.isArray(draft.blocks) && draft.blocks.length > 0;
  const body = hasBlocks
    ? blocksToMarkdown(draft.blocks)
    : (draft.sections || []).map((section) => `## ${section.heading}\n\n${section.body}`).join("\n\n");
  const faq = hasBlocks ? "" : `\n## FAQ\n\n${(draft.faq || []).map((item) => `- ${item}`).join("\n")}`;
  const cta = hasBlocks ? "" : `\n## CTA\n\n${draft.cta || ""}`;

  return `# ${draft.title}

Draft mode: ${draft.draftMode || "newPageDraft"}
Source plan item: ${draft.sourceCalendarItemId || "Not specified"}
Source opportunity: ${draft.sourceOpportunityId || "Not specified"}
Target URL: ${draft.targetUrl || draft.placementUrl || "Not specified"}
Template: ${draft.templateLabel || draft.templateId || "Blog article"}
Meta description: ${draft.meta}

Best placement: ${draft.placement || "Blog CMS article"}
Suggested page URL: ${draft.placementUrl || "Not specified"}
Placement strategy: ${draft.placementStrategy || "Not specified"}

Schema suggestion: ${draft.schemaSuggestion?.type || "Article"} - ${draft.schemaSuggestion?.reason || "Add structured data before export."}

Visual plan: ${draft.visualPlan?.recommended || "product screenshot"} - ${draft.visualPlan?.reason || "Use a relevant product or website visual."}

Visual spec:

\`\`\`
${visualPlanToSpec(draft.visualPlan)}
\`\`\`

Visual references:

${(draft.visualPlan?.referenceImages || []).map((image) => `- ${image.reason || "Reference"}: ${image.url}`).join("\n") || "- None"}

## Website References

${(draft.evidenceRefs || [])
  .map((ref) => `- ${ref.pageTitle || ref.source}: ${ref.url || "no URL"} - ${ref.quote} (${ref.usedFor})`)
  .join("\n")}

## Draft QA

${(draft.qaChecks || []).map((check) => `- ${check.status}: ${check.label} - ${check.detail}`).join("\n")}

${body}${faq}${cta}
`;
};

export const workflowToMarkdown = (workflow) => `# ${workflow.inputs.domain} Site Planning Workspace

## Site Coverage

- Strategy: ${workflow.siteContext?.discovery?.strategy || "unknown"}
- Pages fetched: ${workflow.siteContext?.discovery?.pagesFetched ?? workflow.siteContext?.summary?.pageCount ?? 0}
- Pages discovered: ${workflow.siteContext?.discovery?.pagesDiscovered ?? 0}
- Start URL: ${workflow.siteContext?.startUrl || workflow.inputs.url}

${(workflow.siteContext?.pages || [])
  .slice(0, 30)
  .map((page) => `- ${page.title || page.h1 || page.url}: ${page.url} (${page.pageType || "page"})`)
  .join("\n")}

## Strategy

${Object.entries(workflow.strategy)
  .filter(([key, value]) => key !== "refreshCandidates" && key !== "opportunities" && typeof value !== "object")
  .map(([key, value]) => `- ${key}: ${value}`)
  .join("\n")}

## SEO Opportunity Engine

${gscPerformanceToMarkdown(workflow.gscPerformance)}

${
  (workflow.strategy?.opportunities || []).length
    ? workflow.strategy.opportunities.map((item) => opportunityToMarkdown(item)).join("\n\n")
    : "- No GSC-backed opportunities available yet."
}

## Refresh queue

${
  (workflow.strategy?.refreshCandidates || []).length
    ? workflow.strategy.refreshCandidates
        .map(
          (item) =>
            `- [${item.priority || "medium"}] ${item.title} (${item.url})${item.lastmod ? ` lastmod ${item.lastmod}` : ""}: ${(item.reasons || []).join(" ")}`,
        )
        .join("\n")
    : "- No stale pages flagged."
}

## Search Themes

${workflow.keywords
  .map((keyword) => {
    const questions = (keyword.questionVariants || []).map((question) => `  - ${question}`).join("\n");
    return `- ${keyword.keyword} (${keyword.intent}, value ${keyword.commercialValue}/5, fit ${keyword.productFit}/5)${
      questions ? `\n${questions}` : ""
    }`;
  })
  .join("\n")}

## Opportunity-backed Plan

${(workflow.calendarAudit ? `- Plan review: ${workflow.calendarAudit.failures || 0} failed · ${workflow.calendarAudit.warnings || 0} warnings\n` : "") + workflow.calendar
  .map((item) => {
    const issue = (item.qaChecks || []).find((check) => check.status === "fail");
    const suffix = issue ? ` [needs fix: ${issue.detail}]` : item.suggestedTitle ? ` [suggested: ${item.suggestedTitle}]` : "";
    const metrics = item.opportunityMetrics || {};
    const metricLine = `GSC: ${formatMetricNumber(metrics.impressions)} impressions, ${formatMetricNumber(metrics.clicks)} clicks, ${formatMetricPercent(metrics.ctr)} CTR, avg position ${formatPosition(metrics.position)}`;
    const actions = (item.recommendedActions || []).map((action) => `   - ${action}`).join("\n");
    return `${item.day}. [${item.opportunityType || "crawlFallback"} / ${item.draftMode || "newPageDraft"}] ${item.title} - ${item.keyword}${suffix}
   Target URL: ${item.targetUrl || item.placementUrl || "Not specified"}
   Source opportunity: ${item.sourceOpportunityId || "Not specified"}
   ${metricLine}
${actions || "   - Review before generating."}`;
  })
  .join("\n")}

## Starter Draft

${workflow.drafts?.[0] ? draftToMarkdown(workflow.drafts[0]) : "No starter draft generated yet."}

## Review Checklist

${groupChecklistByCategory(evaluateChecklist(workflow))
  .filter((group) => group.items.length > 0)
  .map((group) => {
    const lines = group.items.map((item) => {
      const prefix =
        item.kind === "auto" ? (item.status === "pass" ? "[auto pass]" : "[auto warn]") : "[manual]";
      return `- [ ] ${prefix} ${checklistLabel(item)}${item.link ? ` (${item.link})` : ""}`;
    });
    return `### ${group.label}\n\n${lines.join("\n")}`;
  })
  .join("\n\n")}
`;
