"use client";

import {
  Plus,
  X,
  Spinner,
  DiceFive,
  Robot,
  MathOperations,
  Check,
  ArrowClockwise,
  Trash,
} from "@phosphor-icons/react";
import { ChatInfo } from "../../lib/api";
import { hmsToMs, msToHms } from "../../lib/duration";
import { useLanguage } from "../../context/LanguageContext";
import { DICE_OPTIONS, toActionTypeOption } from "./actionUtils";
import type { ActionTypeOption, EditingChatDraft } from "./types";

export type ConfigureTargetChatModalProps = {
  draft: EditingChatDraft;
  availableChats: ChatInfo[];
  chatSearch: string;
  chatSearchResults: ChatInfo[];
  chatSearchLoading: boolean;
  loadingChats?: boolean;
  refreshingChats?: boolean;
  onChatSearchChange: (v: string) => void;
  onClearSearch: () => void;
  onRefreshChats: () => void;
  onChange: (next: EditingChatDraft) => void;
  onSave: () => void;
  onCancel: () => void;
};

export function ConfigureTargetChatModal({
  draft,
  availableChats,
  chatSearch,
  chatSearchResults,
  chatSearchLoading,
  loadingChats = false,
  refreshingChats = false,
  onChatSearchChange,
  onClearSearch,
  onRefreshChats,
  onChange,
  onSave,
  onCancel,
}: ConfigureTargetChatModalProps) {
  const { t } = useLanguage();

  const applyChatSelection = (chatId: number, chatName: string) => {
    onChange({
      ...draft,
      chat_id: chatId,
      manual_chat_id: chatId !== 0 ? String(chatId) : "",
      name: chatName,
    });
  };

  const updateAction = (index: number, updater: (action: any) => any) => {
    if (index < 0 || index >= draft.actions.length) return;
    onChange({
      ...draft,
      actions: draft.actions.map((a, i) =>
        i === index ? updater(a || { action: 1, text: "" }) : a
      ),
    });
  };

  const handleAddAction = () => {
    onChange({
      ...draft,
      actions: [...draft.actions, { action: 1, text: "" }],
    });
  };

  const handleRemoveAction = (index: number) => {
    onChange({
      ...draft,
      actions: draft.actions.filter((_, idx) => idx !== index),
    });
  };

  return (
    <div className="modal-overlay active fixed inset-0 z-[100] flex items-center justify-center p-2 sm:p-3">
      <div className="glass-panel modal-content !w-[min(98vw,90rem)] !max-w-[min(98vw,90rem)] max-h-[calc(100vh-1rem)] animate-scale-in flex flex-col overflow-hidden">
        <header className="p-6 border-b border-white/5 flex justify-between items-center bg-black/5">
          <h2 className="text-xl font-bold flex items-center gap-3">
            <div className="p-2 bg-[#8a3ffc]/10 rounded-lg text-[#b57dff]">
              <Plus weight="bold" size={20} />
            </div>
            {t("configure_target_chat")}
          </h2>
          <button onClick={onCancel} className="action-btn !w-8 !h-8">
            <X weight="bold" />
          </button>
        </header>

        <div className="p-6 space-y-6 overflow-y-auto custom-scrollbar">
          <div className="space-y-2">
            <label className="text-xs uppercase tracking-widest font-bold text-main/40">
              {t("select_target_chat")}
            </label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-[10px] text-main/40 uppercase tracking-wider">
                  {t("search_chat")}
                </label>
                <input
                  className="!mb-0"
                  placeholder={t("search_chat_placeholder")}
                  value={chatSearch}
                  onChange={(e) => onChatSearchChange(e.target.value)}
                />
                {chatSearch.trim() ? (
                  <div className="max-h-48 overflow-y-auto rounded-lg border border-white/5 bg-black/5">
                    {chatSearchLoading ? (
                      <div className="px-3 py-2 text-xs text-main/40">{t("searching")}</div>
                    ) : chatSearchResults.length > 0 ? (
                      <div className="flex flex-col">
                        {chatSearchResults.map((chat) => {
                          const title = chat.title || chat.username || String(chat.id);
                          return (
                            <button
                              key={chat.id}
                              type="button"
                              className="text-left px-3 py-2 hover:bg-white/5 border-b border-white/5 last:border-b-0"
                              onClick={() => {
                                applyChatSelection(chat.id, title);
                                onClearSearch();
                              }}
                            >
                              <div className="text-sm font-semibold truncate">{title}</div>
                              <div className="text-[10px] text-main/40 font-mono truncate">
                                {chat.id}
                                {chat.username ? ` · @${chat.username}` : ""}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="px-3 py-2 text-xs text-main/40">{t("search_no_results")}</div>
                    )}
                  </div>
                ) : null}
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] text-main/40 uppercase tracking-wider">
                    {t("select_from_list")}
                  </label>
                  <button
                    type="button"
                    onClick={onRefreshChats}
                    disabled={refreshingChats || loadingChats}
                    className="text-[10px] text-[#8a3ffc] hover:text-[#8a3ffc]/80 transition-colors uppercase font-bold tracking-tighter flex items-center gap-1"
                    title={t("refresh_chat_title")}
                  >
                    {refreshingChats || loadingChats ? (
                      <Spinner className="animate-spin" size={12} />
                    ) : (
                      <ArrowClockwise weight="bold" size={12} />
                    )}
                    {t("refresh_list")}
                  </button>
                </div>
                <select
                  className="!mb-0"
                  value={draft.chat_id}
                  disabled={loadingChats}
                  onChange={(e) => {
                    const cid = parseInt(e.target.value);
                    const chat = availableChats.find((c) => c.id === cid);
                    applyChatSelection(cid, chat?.title || chat?.username || "");
                  }}
                >
                  <option value={0}>
                    {loadingChats ? t("loading") : t("select_chat_placeholder")}
                  </option>
                  {availableChats.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title || c.username || c.id}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-[10px] text-main/40 uppercase tracking-wider">
                  {t("manual_chat_id")}
                </label>
                <input
                  className="!mb-0"
                  placeholder={t("manual_id_placeholder")}
                  value={draft.manual_chat_id}
                  onChange={(e) => {
                    onChange({
                      ...draft,
                      chat_id: 0,
                      manual_chat_id: e.target.value,
                      name: e.target.value.trim()
                        ? `chat_${e.target.value.trim()}`
                        : draft.name,
                    });
                  }}
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] text-main/40 uppercase tracking-wider">
                  {t("delete_after")}
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  className="!mb-0"
                  placeholder={t("delete_after_placeholder")}
                  value={draft.delete_after ?? ""}
                  onChange={(e) => {
                    const cleaned = e.target.value.replace(/[^0-9]/g, "");
                    const val = cleaned === "" ? undefined : Number(cleaned);
                    onChange({
                      ...draft,
                      delete_after: val,
                    });
                  }}
                />
              </div>
              <div className="space-y-3 md:col-span-2">
                <label className="text-[10px] text-main/40 uppercase tracking-wider">
                  {t("action_interval")}
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className={`btn-secondary !h-8 !px-3 !text-[10px] ${
                      draft.action_interval_mode === "fixed"
                        ? "!bg-[#8a3ffc]/20 !border-[#8a3ffc]/40"
                        : ""
                    }`}
                    onClick={() =>
                      onChange({
                        ...draft,
                        action_interval_mode: "fixed",
                        action_interval_ms: draft.action_interval_ms,
                        action_interval: draft.action_interval_ms,
                        action_interval_min_ms: draft.action_interval_ms,
                        action_interval_max_ms: draft.action_interval_ms,
                      })
                    }
                  >
                    {t("action_interval_fixed")}
                  </button>
                  <button
                    type="button"
                    className={`btn-secondary !h-8 !px-3 !text-[10px] ${
                      draft.action_interval_mode === "random"
                        ? "!bg-[#8a3ffc]/20 !border-[#8a3ffc]/40"
                        : ""
                    }`}
                    onClick={() =>
                      onChange({
                        ...draft,
                        action_interval_mode: "random",
                        action_interval_min_ms:
                          draft.action_interval_min_ms ?? draft.action_interval_ms,
                        action_interval_max_ms:
                          draft.action_interval_max_ms ?? draft.action_interval_ms,
                      })
                    }
                  >
                    {t("action_interval_random")}
                  </button>
                </div>
                {draft.action_interval_mode === "fixed" ? (
                  <div className="flex gap-2 items-end">
                    {(["h", "m", "s"] as const).map((part) => {
                      const fixedHms = msToHms(draft.action_interval_ms);
                      return (
                        <div key={part} className="space-y-1">
                          <label className="text-[10px]">
                            {t(
                              part === "h"
                                ? "interval_hour"
                                : part === "m"
                                  ? "interval_minute"
                                  : "interval_second"
                            )}
                          </label>
                          <input
                            inputMode="numeric"
                            className="!mb-0 w-16"
                            value={fixedHms[part]}
                            onChange={(e) => {
                              const raw = e.target.value.replace(/[^0-9]/g, "");
                              const n = raw === "" ? 0 : Number(raw);
                              const next = { ...fixedHms, [part]: n };
                              const ms = hmsToMs(next.h, next.m, next.s);
                              onChange({
                                ...draft,
                                action_interval_ms: ms,
                                action_interval: ms,
                                action_interval_min_ms: ms,
                                action_interval_max_ms: ms,
                              });
                            }}
                          />
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-[10px] text-main/40">{t("action_interval_hint")}</p>
                    <div className="space-y-1">
                      <label className="text-[10px] text-main/40 uppercase tracking-wider">
                        {t("action_interval_min")}
                      </label>
                      <div className="flex gap-2 items-end">
                        {(["h", "m", "s"] as const).map((part) => {
                          const minHms = msToHms(draft.action_interval_min_ms);
                          return (
                            <div key={`min-${part}`} className="space-y-1">
                              <label className="text-[10px]">
                                {t(
                                  part === "h"
                                    ? "interval_hour"
                                    : part === "m"
                                      ? "interval_minute"
                                      : "interval_second"
                                )}
                              </label>
                              <input
                                inputMode="numeric"
                                className="!mb-0 w-16"
                                value={minHms[part]}
                                onChange={(e) => {
                                  const raw = e.target.value.replace(/[^0-9]/g, "");
                                  const n = raw === "" ? 0 : Number(raw);
                                  const next = { ...minHms, [part]: n };
                                  const ms = hmsToMs(next.h, next.m, next.s);
                                  onChange({
                                    ...draft,
                                    action_interval_min_ms: ms,
                                    action_interval_ms: ms,
                                    action_interval: ms,
                                  });
                                }}
                              />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] text-main/40 uppercase tracking-wider">
                        {t("action_interval_max")}
                      </label>
                      <div className="flex gap-2 items-end">
                        {(["h", "m", "s"] as const).map((part) => {
                          const maxHms = msToHms(draft.action_interval_max_ms);
                          return (
                            <div key={`max-${part}`} className="space-y-1">
                              <label className="text-[10px]">
                                {t(
                                  part === "h"
                                    ? "interval_hour"
                                    : part === "m"
                                      ? "interval_minute"
                                      : "interval_second"
                                )}
                              </label>
                              <input
                                inputMode="numeric"
                                className="!mb-0 w-16"
                                value={maxHms[part]}
                                onChange={(e) => {
                                  const raw = e.target.value.replace(/[^0-9]/g, "");
                                  const n = raw === "" ? 0 : Number(raw);
                                  const next = { ...maxHms, [part]: n };
                                  const ms = hmsToMs(next.h, next.m, next.s);
                                  onChange({
                                    ...draft,
                                    action_interval_max_ms: ms,
                                  });
                                }}
                              />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <label className="text-xs uppercase tracking-widest font-bold text-main/40">
                {t("action_sequence_title")}
              </label>
              <button
                type="button"
                onClick={handleAddAction}
                className="btn-secondary !h-7 !px-3 !text-[10px]"
              >
                + {t("add_sign_action")}
              </button>
            </div>

            <div className="max-h-[min(50vh,420px)] overflow-y-auto space-y-3 custom-scrollbar pr-2">
              {draft.actions.map((act, i) => (
                <div
                  key={i}
                  className="flex flex-col md:flex-row gap-3 md:items-center animate-scale-in rounded-xl border border-white/5 bg-black/5 p-3"
                >
                  <div className="shrink-0 w-6 h-10 flex items-center justify-center font-mono text-[10px] text-main/20 font-bold border-r border-white/5">
                    {i + 1}
                  </div>
                  <select
                    className="!w-full md:!w-[170px] !h-10 !mb-0"
                    value={toActionTypeOption(act)}
                    onChange={(e) => {
                      const selectedType = e.target.value as ActionTypeOption;
                      updateAction(i, (currentAction) => {
                        const currentActionId = Number(currentAction?.action);
                        if (selectedType === "1") {
                          return {
                            ...currentAction,
                            action: 1,
                            text: currentAction?.text || "",
                          };
                        }
                        if (selectedType === "3") {
                          return {
                            ...currentAction,
                            action: 3,
                            text: currentAction?.text || "",
                          };
                        }
                        if (selectedType === "2") {
                          return {
                            ...currentAction,
                            action: 2,
                            dice: currentAction?.dice || DICE_OPTIONS[0],
                          };
                        }
                        if (selectedType === "ai_vision") {
                          const nextActionId =
                            currentActionId === 4 || currentActionId === 6
                              ? currentActionId
                              : 6;
                          return { ...currentAction, action: nextActionId };
                        }
                        const nextActionId =
                          currentActionId === 5 || currentActionId === 7
                            ? currentActionId
                            : 5;
                        return { ...currentAction, action: nextActionId };
                      });
                    }}
                  >
                    <option value="1">{t("action_send_text")}</option>
                    <option value="3">{t("action_click_button")}</option>
                    <option value="2">{t("action_send_dice")}</option>
                    <option value="ai_vision">{t("action_ai_vision")}</option>
                    <option value="ai_logic">{t("action_ai_logic")}</option>
                  </select>
                  <div className="flex-1 min-w-0">
                    {(Number(act.action) === 1 || Number(act.action) === 3) && (
                      <input
                        className="!mb-0 !h-10 !text-sm"
                        placeholder={
                          Number(act.action) === 1
                            ? t("placeholder_msg")
                            : t("placeholder_btn")
                        }
                        value={act.text || ""}
                        onChange={(e) => {
                          updateAction(i, (currentAction) => ({
                            ...currentAction,
                            text: e.target.value,
                          }));
                        }}
                      />
                    )}
                    {Number(act.action) === 2 && (
                      <div className="flex items-center gap-2 overflow-x-auto">
                        <div className="w-10 h-10 shrink-0 rounded-xl flex items-center justify-center bg-white/5 border border-white/5 text-main/40">
                          <DiceFive weight="bold" size={18} />
                        </div>
                        {DICE_OPTIONS.map((dice) => (
                          <button
                            key={dice}
                            type="button"
                            className={`w-10 h-10 shrink-0 rounded-xl flex items-center justify-center text-lg transition-all ${
                              act.dice === dice
                                ? "bg-[#8a3ffc]/20 border border-[#8a3ffc]/40"
                                : "bg-white/5 border border-white/5 hover:bg-white/10"
                            }`}
                            onClick={() => {
                              updateAction(i, (currentAction) => ({
                                ...currentAction,
                                dice,
                              }));
                            }}
                          >
                            {dice}
                          </button>
                        ))}
                      </div>
                    )}
                    {(Number(act.action) === 4 || Number(act.action) === 6) && (
                      <div className="h-10 px-3 flex items-center gap-2 bg-indigo-500/10 border border-indigo-500/20 rounded-xl">
                        <Robot weight="fill" size={16} className="text-[#8183ff] shrink-0" />
                        <select
                          className="!mb-0 !h-10 !py-0 !text-xs !w-full"
                          value={Number(act.action) === 4 ? "click" : "send"}
                          onChange={(e) => {
                            const nextActionId = e.target.value === "click" ? 4 : 6;
                            updateAction(i, (currentAction) => ({
                              ...currentAction,
                              action: nextActionId,
                            }));
                          }}
                        >
                          <option value="send">{t("action_ai_vision_send")}</option>
                          <option value="click">{t("action_ai_vision_click")}</option>
                        </select>
                      </div>
                    )}
                    {(Number(act.action) === 5 || Number(act.action) === 7) && (
                      <div className="h-10 px-3 flex items-center gap-2 bg-amber-500/10 border border-amber-500/20 rounded-xl">
                        <MathOperations
                          weight="fill"
                          size={16}
                          className="text-amber-400 shrink-0"
                        />
                        <select
                          className="!mb-0 !h-10 !py-0 !text-xs !w-full"
                          value={Number(act.action) === 7 ? "click" : "send"}
                          onChange={(e) => {
                            const nextActionId = e.target.value === "click" ? 7 : 5;
                            updateAction(i, (currentAction) => ({
                              ...currentAction,
                              action: nextActionId,
                            }));
                          }}
                        >
                          <option value="send">{t("action_ai_logic_send")}</option>
                          <option value="click">{t("action_ai_logic_click")}</option>
                        </select>
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemoveAction(i)}
                    className="action-btn shrink-0 !w-10 !h-10 status-action-danger"
                  >
                    <Trash weight="bold" size={16} />
                  </button>
                </div>
              ))}
              {draft.actions.length === 0 && (
                <div className="text-center py-4 text-xs text-main/20 italic">
                  {t("no_actions_hint")}
                </div>
              )}
            </div>
          </div>
        </div>

        <footer className="p-6 border-t border-white/5 flex gap-4 bg-black/10">
          <button onClick={onCancel} className="btn-secondary flex-1">
            {t("cancel")}
          </button>
          <button
            onClick={onSave}
            className="btn-gradient flex-1 flex items-center justify-center gap-2"
          >
            <Check weight="bold" />
            {t("confirm_add")}
          </button>
        </footer>
      </div>
    </div>
  );
}
