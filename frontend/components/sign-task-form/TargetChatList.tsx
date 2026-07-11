"use client";

import { ChatCircleText, PencilSimple, Trash } from "@phosphor-icons/react";
import { SignTaskChat } from "../../lib/api";
import { formatChatIntervalSummary } from "../../lib/duration";
import { useLanguage } from "../../context/LanguageContext";

type Props = {
  chats: SignTaskChat[];
  onAdd: () => void;
  onEdit: (chat: SignTaskChat, index: number) => void;
  onRemove: (index: number) => void;
};

export function TargetChatList({ chats, onAdd, onEdit, onRemove }: Props) {
  const { t } = useLanguage();

  return (
    <section className="glass-panel p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-[#8a3ffc]/10 rounded-lg text-[#b57dff]">
            <ChatCircleText weight="fill" size={18} />
          </div>
          <h2 className="text-lg font-bold">
            {t("target_chat_config")} ({chats.length})
          </h2>
        </div>
        <button onClick={onAdd} className="btn-secondary !h-8 !px-3 font-bold !text-[10px]">
          + {t("add_chat")}
        </button>
      </div>

      {chats.length === 0 ? (
        <div className="py-10 text-center border-2 border-dashed border-white/5 rounded-2xl text-main/20">
          <p className="text-sm">{t("no_target_chat")}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {chats.map((chat, idx) => (
            <div
              key={idx}
              className="glass-panel !bg-black/5 p-4 flex items-center justify-between group"
            >
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center font-bold text-xs">
                  {idx + 1}
                </div>
                <div>
                  <div className="font-bold text-sm">{chat.name}</div>
                  <div className="text-[10px] text-main/30 font-mono mt-0.5">
                    {t("id_label")}: {chat.chat_id} |{" "}
                    <span className="text-[#8a3ffc]/60 font-bold">
                      {chat.actions.length} {t("actions_count")}
                    </span>
                  </div>
                  <div className="text-[10px] text-main/30 font-mono mt-0.5">
                    {t("action_interval")}: {formatChatIntervalSummary(chat)}
                    {chat.delete_after
                      ? ` | ${t("task_flow_delete_after")}: ${chat.delete_after}s`
                      : ""}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="action-btn"
                  title={t("edit_chat")}
                  onClick={() => onEdit(chat, idx)}
                >
                  <PencilSimple weight="bold" />
                </button>
                <button
                  type="button"
                  onClick={() => onRemove(idx)}
                  className="action-btn status-action-danger"
                >
                  <Trash weight="bold" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
