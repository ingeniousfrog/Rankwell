export const findCalendarItemForDraft = (draft, calendar = []) => {
  if (!draft || !Array.isArray(calendar) || calendar.length === 0) return null;
  if (draft.sourceCalendarItemId) {
    return calendar.find((item) => item.id === draft.sourceCalendarItemId) || null;
  }
  if (!draft.title) return null;
  return calendar.find((item) => item.title === draft.title) || null;
};

export const draftHasRegeneratableSource = (draft, calendar = []) => {
  const item = findCalendarItemForDraft(draft, calendar);
  return Boolean(item && item.isDraftable !== false);
};
