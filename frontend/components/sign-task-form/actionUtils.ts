import type { ActionTypeOption, EditingChatDraft } from "./types";

export const DICE_OPTIONS = [
  "🎲",
  "🎯",
  "🏀",
  "⚽",
  "🎳",
  "🎰",
] as const;

export function toActionTypeOption(action: any): ActionTypeOption {
  const actionId = Number(action?.action);
  if (actionId === 1) return "1";
  if (actionId === 3) return "3";
  if (actionId === 2) return "2";
  if (actionId === 4 || actionId === 6) return "ai_vision";
  if (actionId === 5 || actionId === 7) return "ai_logic";
  return "1";
}

export function isActionValid(action: any): boolean {
  const actionId = Number(action?.action);
  if (actionId === 1 || actionId === 3) {
    return Boolean((action?.text || "").trim());
  }
  if (actionId === 2) {
    return Boolean((action?.dice || "").trim());
  }
  return [4, 5, 6, 7].includes(actionId);
}

export function createEmptyEditingChat(): EditingChatDraft {
  return {
    chat_id: 0,
    name: "",
    manual_chat_id: "",
    actions: [{ action: 1, text: "" }],
    action_interval: 1000,
    action_interval_mode: "fixed",
    action_interval_ms: 1000,
    action_interval_min_ms: 1000,
    action_interval_max_ms: 1000,
  };
}
