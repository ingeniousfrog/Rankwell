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

export const draftToMarkdown = (draft) => {
  const hasBlocks = Array.isArray(draft.blocks) && draft.blocks.length > 0;
  const body = hasBlocks
    ? blocksToMarkdown(draft.blocks)
    : (draft.sections || []).map((section) => `## ${section.heading}\n\n${section.body}`).join("\n\n");
  const faq = hasBlocks ? "" : `\n## FAQ\n\n${(draft.faq || []).map((item) => `- ${item}`).join("\n")}`;
  const cta = hasBlocks ? "" : `\n## CTA\n\n${draft.cta || ""}`;

  return `# ${draft.title}

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
  .filter(([key]) => key !== "refreshCandidates")
  .map(([key, value]) => `- ${key}: ${value}`)
  .join("\n")}

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

## Content Plan

${(workflow.calendarAudit ? `- Plan review: ${workflow.calendarAudit.failures || 0} failed · ${workflow.calendarAudit.warnings || 0} warnings\n` : "") + workflow.calendar
  .map((item) => {
    const issue = (item.qaChecks || []).find((check) => check.status === "fail");
    const suffix = issue ? ` [needs fix: ${issue.detail}]` : item.suggestedTitle ? ` [suggested: ${item.suggestedTitle}]` : "";
    return `${item.day}. ${item.title} - ${item.keyword}${suffix}`;
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
