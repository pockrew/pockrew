// ❄️ FROZEN — repo owner must approve changes. Stop and propose a diff instead of editing.
export type UserIntent =
  | { kind: "attention_ack"; id: string }
  | { kind: "attention_snooze"; id: string; until: number }
  | { kind: "attention_resolve"; id: string }
  | { kind: "receipt_mark_reviewed"; id: string }
  | { kind: "report_seen"; cursor: number }
  | { kind: "pairing_start" }
  | { kind: "pairing_stop" };
