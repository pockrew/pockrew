import type { AttentionItem } from "#contracts/attention.js";

/**
 * "Still needing you": open or acknowledged. Snoozed, resolved and expired items are done with the
 * user. One definition, used by the tracker, the inspector, the mirror and the district filter.
 */
export const isOpenAttention = (item: Pick<AttentionItem, "status">): boolean =>
  item.status === "open" || item.status === "acknowledged";
