import { resolveProductLabel } from "./content-audit.js";
import { resolveDraftTemplate } from "./draft-templates.js";

export const normalizeDraftIntent = (raw = {}, calendarItem = {}, input = {}) => {
  const template = resolveDraftTemplate(calendarItem);
  const product = resolveProductLabel(input);
  const keyword = calendarItem.keyword || "";
  const mustCover = Array.isArray(raw.mustCover)
    ? raw.mustCover.filter((item) => typeof item === "string" && item.trim()).slice(0, 6)
    : [];
  const mustAvoid = Array.isArray(raw.mustAvoid)
    ? raw.mustAvoid.filter((item) => typeof item === "string" && item.trim()).slice(0, 8)
    : [];

  const defaultMustCover = [
    `What ${keyword} solves for the reader`,
    `How ${product} handles the workflow`,
    `A concrete first step the reader can take today`,
  ];

  const defaultMustAvoid = [
    "SEO tooling or content machine language",
    "Generic buzzwords like leverage, unlock, seamless",
    "In today's fast-paced digital landscape",
    "Describing this app's workflow instead of the product",
  ];

  const sectionOutline = Array.isArray(raw.sectionOutline) && raw.sectionOutline.length > 0
    ? raw.sectionOutline.map((section, index) => ({
        id: section.id || `s${index + 1}`,
        purpose: String(section.purpose || "").trim(),
        transitionFrom: String(section.transitionFrom || (index === 0 ? "Opens from the headline promise" : "Builds on the previous section")).trim(),
        evidenceUrls: Array.isArray(section.evidenceUrls)
          ? section.evidenceUrls.filter((url) => typeof url === "string").slice(0, 3)
          : [],
      }))
    : buildFallbackSectionOutline(template, calendarItem, input);

  return {
    angle: String(raw.angle || `A focused ${calendarItem.format || "guide"} on ${keyword} for ${input.audience || "readers"}.`).trim(),
    readerProblem: String(
      raw.readerProblem || `Readers searching for ${keyword} need a clear path without generic advice.`,
    ).trim(),
    mustCover: mustCover.length >= 3 ? mustCover : defaultMustCover,
    mustAvoid: mustAvoid.length >= 2 ? mustAvoid : defaultMustAvoid,
    sectionOutline,
    urlStrategy: {
      strategy: raw.urlStrategy?.strategy === "refresh" ? "refresh" : "net-new",
      targetUrl: String(raw.urlStrategy?.targetUrl || "").trim(),
      reason: String(raw.urlStrategy?.reason || "").trim(),
    },
    voiceNotes: String(raw.voiceNotes || `Match ${input.voice || "editorial"} voice: specific, grounded, no filler.`).trim(),
  };
};

export const buildFallbackSectionOutline = (template, calendarItem = {}, input = {}) => {
  const keyword = calendarItem.keyword || input.category || "topic";
  if (template.id === "productPage") {
    return [
      { id: "s1", purpose: `State the ${keyword} value proposition`, transitionFrom: "Opens from headline", evidenceUrls: [] },
      { id: "s2", purpose: "Walk through the product workflow in steps", transitionFrom: "After establishing the problem", evidenceUrls: [] },
      { id: "s3", purpose: "Highlight differentiated features with site evidence", transitionFrom: "After showing how it works", evidenceUrls: [] },
      { id: "s4", purpose: "Address common objections in FAQ", transitionFrom: "After features", evidenceUrls: [] },
      { id: "s5", purpose: "Close with a specific CTA", transitionFrom: "After FAQ", evidenceUrls: [] },
    ];
  }
  if (template.id === "comparisonPage") {
    return [
      { id: "s1", purpose: "Frame the buyer decision for " + keyword, transitionFrom: "Opens from headline", evidenceUrls: [] },
      { id: "s2", purpose: "Compare options with honest tradeoffs", transitionFrom: "After framing the decision", evidenceUrls: [] },
      { id: "s3", purpose: "Deliver a clear verdict", transitionFrom: "After comparison", evidenceUrls: [] },
      { id: "s4", purpose: "Answer remaining questions", transitionFrom: "After verdict", evidenceUrls: [] },
    ];
  }
  if (template.id === "docsGuide") {
    return [
      { id: "s1", purpose: "Explain what the reader will accomplish", transitionFrom: "Opens from headline", evidenceUrls: [] },
      { id: "s2", purpose: "Provide step-by-step instructions", transitionFrom: "After intro", evidenceUrls: [] },
      { id: "s3", purpose: "Troubleshoot common issues", transitionFrom: "After steps", evidenceUrls: [] },
    ];
  }
  return [
    { id: "s1", purpose: `Introduce the reader problem around ${keyword}`, transitionFrom: "Opens from headline", evidenceUrls: [] },
    { id: "s2", purpose: "Explain the workflow or approach", transitionFrom: "After problem setup", evidenceUrls: [] },
    { id: "s3", purpose: "Show how the product fits the workflow", transitionFrom: "After explaining the approach", evidenceUrls: [] },
    { id: "s4", purpose: "Give review-ready next steps", transitionFrom: "After product fit", evidenceUrls: [] },
  ];
};

export const buildFallbackIntent = (calendarItem = {}, input = {}, siteContext = null) => {
  const template = resolveDraftTemplate(calendarItem);
  const pages = (siteContext?.pages || []).slice(0, 3);
  const evidenceUrls = pages.map((page) => page.url).filter(Boolean);

  const outline = buildFallbackSectionOutline(template, calendarItem, input).map((section, index) => ({
    ...section,
    evidenceUrls: evidenceUrls.slice(index, index + 1),
  }));

  return normalizeDraftIntent(
    {
      angle: `Help ${input.audience || "readers"} solve ${calendarItem.keyword} with ${input.domain || "the product"}.`,
      readerProblem: `Generic advice on ${calendarItem.keyword} wastes time; readers need a product-grounded path.`,
      mustCover: [
        `The specific problem behind ${calendarItem.keyword}`,
        `How ${resolveProductLabel(input, siteContext)} addresses it`,
        pages[0]?.h1 ? `Reference: ${pages[0].h1}` : "A concrete workflow step",
      ],
      sectionOutline: outline,
    },
    calendarItem,
    input,
  );
};
