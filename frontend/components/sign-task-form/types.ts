export type ActionTypeOption = "1" | "2" | "3" | "ai_vision" | "ai_logic";

export type EditingChatDraft = {
  chat_id: number;
  name: string;
  manual_chat_id: string;
  actions: any[];
  delete_after?: number;
  action_interval: number;
  action_interval_mode: "fixed" | "random";
  action_interval_ms: number;
  action_interval_min_ms: number;
  action_interval_max_ms: number;
  editIndex?: number;
};
