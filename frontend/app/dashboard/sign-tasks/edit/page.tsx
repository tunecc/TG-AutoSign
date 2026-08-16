"use client";

import { useEffect, useState, useCallback, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getToken } from "../../../../lib/auth";
import {
    getSignTask,
    updateSignTask,
    getAccountChats,
    searchAccountChats,
    ChatInfo,
    SignTaskChat,
} from "../../../../lib/api";
import {
    normalizeChatInterval,
    validateIntervalFields,
} from "../../../../lib/duration";
import {
    parseTaskFormFrom,
    resolveTaskFormReturnPath,
} from "../../../../lib/task-form-nav";
import {
    CaretLeft,
    Clock,
    Spinner,
    Lightning,
} from "@phosphor-icons/react";

import { ThemeLanguageToggle } from "../../../../components/ThemeLanguageToggle";
import { useLanguage } from "../../../../context/LanguageContext";
import { ToastContainer, useToast } from "../../../../components/ui/toast";
import { TargetChatList } from "../../../../components/sign-task-form/TargetChatList";
import { ConfigureTargetChatModal } from "../../../../components/sign-task-form/ConfigureTargetChatModal";
import {
    createEmptyEditingChat,
    isActionValid,
} from "../../../../components/sign-task-form/actionUtils";
import type { EditingChatDraft } from "../../../../components/sign-task-form/types";

type ScheduleMode = "fixed" | "range";

const fixedTimeToCron = (value: string) => {
    const [rawHour, rawMinute] = value.split(":");
    const hour = Number(rawHour);
    const minute = Number(rawMinute);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
        return "";
    }
    return `0 ${minute} ${hour} * * *`;
};

function cronToFixedTime(cron: string): string {
    // expect "0 M H * * *"
    const parts = (cron || "").trim().split(/\s+/);
    if (parts.length >= 3) {
        const minute = Number(parts[1]);
        const hour = Number(parts[2]);
        if (Number.isFinite(minute) && Number.isFinite(hour)) {
            return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
        }
    }
    return "06:00";
}

function EditSignTaskContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const fromParam = parseTaskFormFrom(searchParams.get("from"));
    const accountParam = (searchParams.get("account") || "").trim();
    const nameParam = (searchParams.get("name") || "").trim();
    const { t } = useLanguage();
    const { toasts, addToast, removeToast } = useToast();
    const [token, setLocalToken] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [pageLoading, setPageLoading] = useState(true);
    const loadedKeyRef = useRef<string | null>(null);

    const [originalName, setOriginalName] = useState("");
    const [taskName, setTaskName] = useState("");
    const [executionMode, setExecutionMode] = useState<ScheduleMode>("range");
    const [signAt, setSignAt] = useState("06:00");
    const [rangeStart, setRangeStart] = useState("09:00");
    const [rangeEnd, setRangeEnd] = useState("18:00");
    const [randomSeconds, setRandomSeconds] = useState(0);
    const [signInterval, setSignInterval] = useState(1);
    const [chats, setChats] = useState<SignTaskChat[]>([]);

    const [availableChats, setAvailableChats] = useState<ChatInfo[]>([]);
    const [loadingChats, setLoadingChats] = useState(false);
    const [refreshingChats, setRefreshingChats] = useState(false);
    const [chatSearch, setChatSearch] = useState("");
    const [chatSearchResults, setChatSearchResults] = useState<ChatInfo[]>([]);
    const [chatSearchLoading, setChatSearchLoading] = useState(false);

    const [editingChat, setEditingChat] = useState<EditingChatDraft | null>(null);

    const formatErrorMessage = useCallback((key: string, err?: any) => {
        const base = t(key);
        const code = err?.code;
        return code ? `${base} (${code})` : base;
    }, [t]);

    const handleAccountSessionInvalid = useCallback((err: any) => {
        if (err?.code !== "ACCOUNT_SESSION_INVALID") return false;
        addToast(t("account_session_invalid"), "error");
        setTimeout(() => {
            router.replace("/dashboard");
        }, 800);
        return true;
    }, [addToast, router, t]);

    const goBack = useCallback(() => {
        router.push(resolveTaskFormReturnPath(fromParam, accountParam));
    }, [router, fromParam, accountParam]);

    const handleCancel = useCallback(() => {
        goBack();
    }, [goBack]);

    const loadChats = useCallback(async (tokenStr: string, accountName: string, forceRefresh = false) => {
        try {
            setLoadingChats(true);
            const chatsData = await getAccountChats(tokenStr, accountName, forceRefresh);
            setAvailableChats(chatsData);
            return chatsData;
        } catch (err: any) {
            if (handleAccountSessionInvalid(err)) return;
            addToast(formatErrorMessage(forceRefresh ? "refresh_failed" : "load_failed", err), "error");
            return [];
        } finally {
            setLoadingChats(false);
        }
    }, [addToast, formatErrorMessage, handleAccountSessionInvalid]);

    const loadTask = useCallback(async (tokenStr: string, taskName: string, accountName: string) => {
        try {
            setPageLoading(true);
            const task = await getSignTask(tokenStr, taskName, accountName);
            setOriginalName(task.name);
            setTaskName(task.name);
            const mode: ScheduleMode = task.execution_mode === "range" ? "range" : "fixed";
            setExecutionMode(mode);
            setSignAt(cronToFixedTime(task.sign_at || ""));
            setRangeStart(task.range_start || "09:00");
            setRangeEnd(task.range_end || "18:00");
            setRandomSeconds(task.random_seconds ?? 0);
            setSignInterval(task.sign_interval ?? 1);
            setChats((task.chats || []).map((c) => normalizeChatInterval(c)));
            loadChats(tokenStr, accountName);
        } catch (err: any) {
            if (handleAccountSessionInvalid(err)) return;
            const key = err?.status === 404 ? "task_not_found" : "task_load_failed";
            addToast(formatErrorMessage(key, err), "error");
            setTimeout(() => {
                router.replace(resolveTaskFormReturnPath(fromParam, accountName));
            }, 600);
        } finally {
            setPageLoading(false);
        }
    }, [addToast, formatErrorMessage, fromParam, handleAccountSessionInvalid, loadChats, router]);

    useEffect(() => {
        const tokenStr = getToken();
        if (!tokenStr) {
            router.replace("/");
            return;
        }
        setLocalToken(tokenStr);

        if (!accountParam || !nameParam) {
            addToast(t("invalid_edit_params"), "error");
            router.replace(resolveTaskFormReturnPath(fromParam, accountParam));
            return;
        }

        const key = `${tokenStr}|${accountParam}|${nameParam}`;
        if (loadedKeyRef.current === key) return;
        loadedKeyRef.current = key;
        loadTask(tokenStr, nameParam, accountParam);
    }, [router, accountParam, nameParam, fromParam, addToast, t, loadTask]);

    useEffect(() => {
        if (!token || !accountParam) return;
        const query = chatSearch.trim();
        if (!query) {
            setChatSearchResults([]);
            setChatSearchLoading(false);
            return;
        }
        let cancelled = false;
        setChatSearchLoading(true);
        const timer = setTimeout(async () => {
            try {
                const res = await searchAccountChats(token, accountParam, query, 50, 0);
                if (!cancelled) {
                    setChatSearchResults(res.items || []);
                }
            } catch (err: any) {
                if (!cancelled) {
                    if (handleAccountSessionInvalid(err)) return;
                    addToast(formatErrorMessage("search_failed", err), "error");
                    setChatSearchResults([]);
                }
            } finally {
                if (!cancelled) {
                    setChatSearchLoading(false);
                }
            }
        }, 300);
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [chatSearch, token, accountParam, addToast, formatErrorMessage, handleAccountSessionInvalid]);

    useEffect(() => {
        if (!editingChat) {
            setChatSearch("");
            setChatSearchResults([]);
            setChatSearchLoading(false);
        }
    }, [editingChat, accountParam]);

    const handleAddChat = () => {
        setEditingChat(createEmptyEditingChat());
    };

    const handleRefreshChats = async () => {
        if (!token || !accountParam) return;
        try {
            setRefreshingChats(true);
            await loadChats(token, accountParam, true);
            addToast(t("chats_refreshed"), "success");
        } finally {
            setRefreshingChats(false);
        }
    };

    const handleSaveChat = () => {
        if (!editingChat) return;
        let resolvedChatId = editingChat.chat_id;
        const manualChatId = editingChat.manual_chat_id.trim();
        if (manualChatId) {
            resolvedChatId = Number(manualChatId);
            if (!Number.isFinite(resolvedChatId)) {
                addToast(t("chat_id_numeric"), "error");
                return;
            }
        }
        if (resolvedChatId === 0) {
            addToast(t("select_chat_error"), "error");
            return;
        }
        if (editingChat.actions.length === 0 || editingChat.actions.some((action) => !isActionValid(action))) {
            addToast(t("add_action_error"), "error");
            return;
        }
        const intervalErr = validateIntervalFields(editingChat);
        if (intervalErr) {
            addToast(t(intervalErr), "error");
            return;
        }
        const interval = normalizeChatInterval(editingChat);
        const { manual_chat_id: _m, editIndex, ...rest } = editingChat;
        const chatPayload = {
            ...rest,
            ...interval,
            chat_id: resolvedChatId,
            name: rest.name || `chat_${resolvedChatId}`,
            delete_after: rest.delete_after === undefined ? undefined : Number(rest.delete_after),
        };

        setChats((prev) => {
            if (typeof editIndex === "number" && editIndex >= 0 && editIndex < prev.length) {
                const next = [...prev];
                next[editIndex] = chatPayload;
                return next;
            }
            return [...prev, chatPayload];
        });
        setEditingChat(null);
    };

    const handleSubmit = async () => {
        if (!token || !accountParam || !originalName) return;

        const fixedCron =
            executionMode === "fixed" ? fixedTimeToCron(signAt) : "0 0 * * *";
        if (executionMode === "fixed" && !fixedCron) {
            addToast(t("fixed_time_required"), "error");
            return;
        }
        if (executionMode === "range" && (!rangeStart || !rangeEnd)) {
            addToast(t("range_required"), "error");
            return;
        }
        if (chats.length === 0) {
            addToast(t("chat_required"), "error");
            return;
        }

        try {
            setLoading(true);
            await updateSignTask(
                token,
                originalName,
                {
                    name: taskName.trim() || originalName,
                    sign_at: fixedCron,
                    chats: chats.map((c) => normalizeChatInterval(c)),
                    random_seconds: randomSeconds,
                    sign_interval: signInterval,
                    execution_mode: executionMode,
                    range_start: rangeStart,
                    range_end: rangeEnd,
                },
                accountParam
            );
            addToast(t("update_success"), "success");
            router.push(resolveTaskFormReturnPath(fromParam, accountParam));
        } catch (err: any) {
            if (handleAccountSessionInvalid(err)) return;
            addToast(formatErrorMessage("update_failed", err), "error");
        } finally {
            setLoading(false);
        }
    };

    if (!token) return null;

    if (pageLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <Spinner className="animate-spin" size={32} weight="bold" />
            </div>
        );
    }

    return (
        <div id="edit-task-view" className="w-full h-full flex flex-col pt-[72px]">
            <nav className="navbar fixed top-0 left-0 right-0 z-50 h-[72px] px-5 md:px-10 flex justify-between items-center glass-panel rounded-none border-x-0 border-t-0 bg-white/2 dark:bg-black/5">
                <div className="flex items-center gap-4">
                    <button onClick={handleCancel} className="action-btn" title={t("cancel")}>
                        <CaretLeft weight="bold" />
                    </button>
                    <div className="flex items-center gap-2 text-sm font-medium">
                        <span className="text-main/40 uppercase tracking-widest text-[10px]">{t("sidebar_tasks")}</span>
                        <span className="text-main/20">/</span>
                        <span className="text-main uppercase tracking-widest text-[10px]">{t("edit_task")}</span>
                    </div>
                </div>
                <div className="flex items-center gap-4">
                    <ThemeLanguageToggle />
                </div>
            </nav>

            <main className="flex-1 p-5 md:p-10 w-full max-w-[900px] mx-auto overflow-y-auto animate-float-up pb-20">
                <header className="mb-10">
                    <h1 className="text-3xl font-bold tracking-tight mb-2">{t("edit_task_page_title")}</h1>
                    <p className="text-[#9496a1] text-sm">{t("edit_task_page_desc")}</p>
                </header>

                <div className="grid gap-8">
                    <section className="glass-panel p-6 space-y-6">
                        <div className="flex items-center gap-3 mb-2">
                            <div className="p-2 bg-[#8a3ffc]/10 rounded-lg text-[#b57dff]">
                                <Lightning weight="fill" size={18} />
                            </div>
                            <h2 className="text-lg font-bold">{t("basic_config")}</h2>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="space-y-2">
                                <label className="text-xs font-bold text-main/40 uppercase tracking-wider">{t("task_name")}</label>
                                <input
                                    className="!mb-0"
                                    value={taskName}
                                    onChange={(e) => setTaskName(e.target.value)}
                                    placeholder={t("task_name_placeholder")}
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs font-bold text-main/40 uppercase tracking-wider">{t("account_readonly")}</label>
                                <input
                                    className="!mb-0 opacity-70"
                                    value={accountParam}
                                    disabled
                                    readOnly
                                />
                            </div>
                        </div>

                        <div className="p-4 glass-panel !bg-black/5 space-y-4 border-white/5">
                            <div className="flex items-center gap-3 mb-2">
                                <div className="p-2 bg-[#8a3ffc]/10 rounded-lg text-[#b57dff]">
                                    <Clock weight="fill" size={16} />
                                </div>
                                <label className="text-xs font-bold text-main/40 uppercase tracking-wider">
                                    {t("scheduling_mode")}
                                </label>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 animate-fade-in">
                                <div className="space-y-2">
                                    <label className="text-xs font-bold text-main/40 uppercase tracking-wider">{t("scheduling_mode")}</label>
                                    <select
                                        className="!mb-0"
                                        value={executionMode}
                                        onChange={(e) => setExecutionMode(e.target.value as ScheduleMode)}
                                    >
                                        <option value="range">{t("random_range_recommend")}</option>
                                        <option value="fixed">{t("fixed_time")}</option>
                                    </select>
                                </div>
                                {executionMode === "fixed" ? (
                                    <div className="space-y-2">
                                        <label className="text-xs font-bold text-main/40 uppercase tracking-wider">{t("fixed_time")}</label>
                                        <input
                                            type="time"
                                            className="!mb-0"
                                            value={signAt}
                                            onChange={(e) => setSignAt(e.target.value)}
                                        />
                                    </div>
                                ) : (
                                    <>
                                        <div className="space-y-2">
                                            <label className="text-xs font-bold text-main/40 uppercase tracking-wider">{t("start_time")}</label>
                                            <input
                                                type="time"
                                                className="!mb-0"
                                                value={rangeStart}
                                                onChange={(e) => setRangeStart(e.target.value)}
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-xs font-bold text-main/40 uppercase tracking-wider">{t("end_time")}</label>
                                            <input
                                                type="time"
                                                className="!mb-0"
                                                value={rangeEnd}
                                                onChange={(e) => setRangeEnd(e.target.value)}
                                            />
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>
                    </section>

                    <TargetChatList
                        chats={chats}
                        onAdd={handleAddChat}
                        onEdit={(chat, idx) => {
                            const n = normalizeChatInterval(chat);
                            setEditingChat({
                                chat_id: chat.chat_id,
                                name: chat.name,
                                manual_chat_id: String(chat.chat_id),
                                actions: chat.actions || [],
                                delete_after: chat.delete_after,
                                ...n,
                                editIndex: idx,
                            });
                        }}
                        onRemove={(idx) => setChats((prev) => prev.filter((_, i) => i !== idx))}
                    />

                    <div className="flex gap-4 pt-4">
                        <button onClick={handleCancel} className="btn-secondary flex-1">{t("cancel")}</button>
                        <button onClick={handleSubmit} disabled={loading} className="btn-gradient flex-1">
                            {loading ? <Spinner className="animate-spin mx-auto" weight="bold" /> : t("save_changes")}
                        </button>
                    </div>
                </div>
            </main>

            {editingChat && (
                <ConfigureTargetChatModal
                    draft={editingChat}
                    availableChats={availableChats}
                    chatSearch={chatSearch}
                    chatSearchResults={chatSearchResults}
                    chatSearchLoading={chatSearchLoading}
                    loadingChats={loadingChats}
                    refreshingChats={refreshingChats}
                    onChatSearchChange={setChatSearch}
                    onClearSearch={() => {
                        setChatSearch("");
                        setChatSearchResults([]);
                    }}
                    onRefreshChats={handleRefreshChats}
                    onChange={setEditingChat}
                    onSave={handleSaveChat}
                    onCancel={() => setEditingChat(null)}
                />
            )}

            <ToastContainer toasts={toasts} removeToast={removeToast} />
        </div>
    );
}

export default function EditSignTaskPage() {
    const { t } = useLanguage();
    return (
        <Suspense fallback={<div className="min-h-screen flex items-center justify-center">{t("loading")}</div>}>
            <EditSignTaskContent />
        </Suspense>
    );
}
