import {
  detectFatigueWords,
  detectForbiddenPatterns,
  detectGenericFiller,
} from "./anti-ai-rules.js";
import { auditDraft } from "./draft-templates.js";

const qa = (label, status, detail) => ({ label, status, detail });

const collectDraftText = (draft) => {
  const chunks = [draft.title, draft.meta, draft.cta];
  for (const section of draft.sections || []) {
    chunks.push(section.heading, section.body);
  }
  for (const block of draft.blocks || []) {
    chunks.push(block.heading, block.subheading, block.body, block.buttonText);
    for (const item of block.items || []) {
      chunks.push(item.title, item.body, item.summary, item.question, item.answer, item.label);
    }
  }
  for (const item of draft.faq || []) chunks.push(item);
  return chunks.filter(Boolean).join("\n");
};

const collectSectionBodies = (draft) => {
  if (Array.isArray(draft.sections) && draft.sections.length > 0) {
    return draft.sections.map((section) => ({
      heading: section.heading || "",
      body: section.body || "",
    }));
  }
  const bodies = [];
  for (const block of draft.blocks || []) {
    if (block.body) bodies.push({ heading: block.heading || block.type || "", body: block.body });
    for (const item of block.items || []) {
      if (item.body || item.summary) {
        bodies.push({ heading: item.title || item.label || "", body: item.body || item.summary || "" });
      }
    }
  }
  return bodies;
};

const tokenize = (text) =>
  String(text || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 3);

const coverageScore = (text, phrases) => {
  const lower = String(text || "").toLowerCase();
  return phrases.filter((phrase) => {
    const tokens = tokenize(phrase);
    if (tokens.length === 0) return false;
    const matched = tokens.filter((token) => lower.includes(token)).length;
    return matched / tokens.length >= 0.5;
  });
};

const extractSiteFeatureTokens = (siteContext) => {
  const tokens = new Set();
  for (const page of siteContext?.pages || []) {
    for (const token of tokenize(`${page.h1 || ""} ${page.title || ""} ${page.metaDescription || ""}`)) {
      tokens.add(token);
    }
    for (const h2 of page.headings?.h2 || []) {
      for (const token of tokenize(h2)) tokens.add(token);
    }
  }
  return [...tokens].slice(0, 40);
};

const detectRepetition = (sections) => {
  const openings = sections.map((section) => {
    const firstSentence = String(section.body || "").split(/[.!?]/)[0]?.trim().toLowerCase() || "";
    return firstSentence.slice(0, 60);
  });
  const duplicates = openings.filter((opening, index) => opening && openings.indexOf(opening) !== index);
  return [...new Set(duplicates)];
};

const detectParallelSentences = (text) => {
  const sentences = String(text || "")
    .split(/[.!?]+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 10);
  let streak = 1;
  for (let index = 1; index < sentences.length; index += 1) {
    const prevWords = sentences[index - 1].split(/\s+/).length;
    const currWords = sentences[index].split(/\s+/).length;
    if (Math.abs(prevWords - currWords) <= 2 && prevWords <= 12) {
      streak += 1;
      if (streak >= 3) return true;
    } else {
      streak = 1;
    }
  }
  return false;
};

export const auditDraftQuality = (draft, draftIntent = null, siteContext = null, inputs = {}) => {
  const checks = [];
  const reviseHints = [];
  const text = collectDraftText(draft);
  const voice = String(inputs.voice || "editorial").toLowerCase();

  const fatigueHits = detectFatigueWords(text, voice);
  const failFatigue = fatigueHits.filter((hit) => hit.severity === "fail");
  if (failFatigue.length > 0) {
    checks.push(
      qa("AI flavor", "fail", `Fatigue words detected: ${failFatigue.map((hit) => hit.word).join(", ")}.`),
    );
    reviseHints.push({
      mode: "anti-detect",
      target: "full",
      detail: `Replace fatigue words: ${failFatigue.map((hit) => hit.word).join(", ")}.`,
    });
  } else if (fatigueHits.length > 0) {
    checks.push(qa("AI flavor", "warn", `Minor fatigue words: ${fatigueHits.map((hit) => hit.word).join(", ")}.`));
  } else {
    checks.push(qa("AI flavor", "pass", "No common AI fatigue words detected."));
  }

  const forbiddenHits = detectForbiddenPatterns(text);
  if (forbiddenHits.length > 0) {
    checks.push(
      qa("AI patterns", "fail", `Forbidden patterns: ${forbiddenHits.map((hit) => hit.label).join("; ")}.`),
    );
    reviseHints.push({
      mode: "anti-detect",
      target: "full",
      detail: `Remove patterns: ${forbiddenHits.map((hit) => hit.label).join("; ")}.`,
    });
  } else {
    checks.push(qa("AI patterns", "pass", "No forbidden AI-style sentence patterns."));
  }

  const fillerHits = detectGenericFiller(text);
  if (fillerHits.length >= 2) {
    checks.push(qa("Generic filler", "warn", `Generic filler phrases: ${fillerHits.slice(0, 3).join(", ")}.`));
    reviseHints.push({ mode: "spot-fix", target: "sections", detail: "Replace generic filler with product-specific copy." });
  } else if (fillerHits.length === 1) {
    checks.push(qa("Generic filler", "warn", `Generic filler phrase: ${fillerHits[0]}.`));
  } else {
    checks.push(qa("Generic filler", "pass", "Copy avoids common generic filler phrases."));
  }

  if (detectParallelSentences(text)) {
    checks.push(qa("Sentence rhythm", "warn", "Three or more parallel short sentences detected."));
    reviseHints.push({ mode: "spot-fix", target: "sections", detail: "Vary sentence length and structure." });
  } else {
    checks.push(qa("Sentence rhythm", "pass", "Sentence rhythm varies enough."));
  }

  const sections = collectSectionBodies(draft);
  const repeatedOpenings = detectRepetition(sections);
  if (repeatedOpenings.length > 0) {
    checks.push(qa("Repetition", "warn", "Adjacent or duplicate section openings detected."));
    reviseHints.push({ mode: "spot-fix", target: "sections", detail: "Rewrite repeated section openings." });
  } else {
    checks.push(qa("Repetition", "pass", "Section openings are distinct."));
  }

  if (draftIntent?.mustCover?.length) {
    const covered = coverageScore(text, draftIntent.mustCover);
    const missing = draftIntent.mustCover.filter((item) => !covered.includes(item));
    if (missing.length > 0) {
      checks.push(
        qa("Intent adherence", "fail", `Must-cover points missing: ${missing.slice(0, 3).join("; ")}.`),
      );
      reviseHints.push({
        mode: "spot-fix",
        target: "sections",
        detail: `Cover these points: ${missing.join("; ")}.`,
      });
    } else {
      checks.push(qa("Intent adherence", "pass", "All must-cover intent points appear in the draft."));
    }
  }

  if (draftIntent?.sectionOutline?.length && sections.length > 0) {
    let flowFails = 0;
    for (const outline of draftIntent.sectionOutline) {
      const purposeTokens = tokenize(outline.purpose || "");
      if (purposeTokens.length === 0) continue;
      const sectionText = sections.map((section) => `${section.heading} ${section.body}`).join(" ").toLowerCase();
      const matched = purposeTokens.filter((token) => sectionText.includes(token)).length;
      if (matched / purposeTokens.length < 0.34) flowFails += 1;
    }
    if (flowFails > Math.floor(draftIntent.sectionOutline.length / 2)) {
      checks.push(qa("Narrative flow", "fail", "Draft sections do not follow the planned outline purposes."));
      reviseHints.push({
        mode: "spot-fix",
        target: "sections",
        detail: "Align each section with sectionOutline purpose and transitionFrom.",
      });
    } else if (flowFails > 0) {
      checks.push(qa("Narrative flow", "warn", "Some outline purposes are weakly reflected in the draft."));
    } else {
      checks.push(qa("Narrative flow", "pass", "Draft follows the planned section outline."));
    }
  }

  const featureTokens = extractSiteFeatureTokens(siteContext);
  if (featureTokens.length > 0 && siteContext?.ok) {
    const lower = text.toLowerCase();
    const matched = featureTokens.filter((token) => lower.includes(token)).length;
    if (matched < 2) {
      checks.push(
        qa("Specificity", "fail", "Draft lacks concrete product terms from crawled site pages."),
      );
      reviseHints.push({
        mode: "spot-fix",
        target: "sections",
        detail: "Include specific product features or terms from site pages.",
      });
    } else if (matched < 4) {
      checks.push(qa("Specificity", "warn", "Draft could include more site-specific product terminology."));
    } else {
      checks.push(qa("Specificity", "pass", "Draft uses site-specific product terminology."));
    }
  }

  const criticalFailures = checks.filter((check) => check.status === "fail");
  return {
    checks,
    criticalFailures,
    reviseHints,
    hasCriticalFailures: criticalFailures.length > 0,
    reviseMode: reviseHints.some((hint) => hint.mode === "anti-detect") ? "anti-detect" : "spot-fix",
  };
};

export const auditDraftFull = (draft, calendarItem = {}, siteContext = null, inputs = {}, draftIntent = null) => {
  const structural = auditDraft(draft, calendarItem, siteContext, inputs);
  const quality = auditDraftQuality(draft, draftIntent, siteContext, inputs);

  const existingLabels = new Set(structural.checks.map((check) => check.label));
  const mergedChecks = [
    ...structural.checks,
    ...quality.checks.filter((check) => !existingLabels.has(check.label)),
  ];

  const criticalFailures = mergedChecks.filter((check) => check.status === "fail");

  return {
    template: structural.template,
    checks: mergedChecks,
    suggestedPlacement: structural.suggestedPlacement,
    hasFailures: criticalFailures.length > 0,
    criticalFailures,
    reviseHints: quality.reviseHints,
    reviseMode: quality.reviseMode,
  };
};
