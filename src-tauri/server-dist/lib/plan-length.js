export const PLAN_LENGTH_MIN = 5;
export const PLAN_LENGTH_MAX = 30;
export const DEFAULT_PLAN_LENGTH = 14;

export const normalizePlanLength = (value, fallback = DEFAULT_PLAN_LENGTH) => {
  const number = Number(value);
  const resolved = Number.isFinite(number) ? Math.round(number) : fallback;
  return Math.min(PLAN_LENGTH_MAX, Math.max(PLAN_LENGTH_MIN, resolved));
};
