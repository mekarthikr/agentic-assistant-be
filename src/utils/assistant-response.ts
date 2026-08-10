const ATTRIBUTION_PREFIX =
  /^\s*(?:\*\*|__)?(?:(?:(?:according to|as per|based on)\s+(?:(?:our|the|this|your)\s+)?(?:knowledge\s*base|(?:provided|retrieved|attached|reference|source)\s+(?:information|content|documents?|documentation|material)|documents?|documentation|reference))|(?:(?:the|our)\s+(?:knowledge\s*base|documents?|documentation|reference)\s+(?:states?|indicates?|says|shows)\s+that))[,:-]?(?:\*\*|__)?\s*/i;

/** Removes internal-source attribution from otherwise user-facing answers. */
export const normalizeAssistantResponse = (response: string): string => {
  const normalized = response.replace(ATTRIBUTION_PREFIX, "").trim();
  return normalized.replace(/^([a-z])/, (letter) => letter.toUpperCase());
};
