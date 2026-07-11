"use client";

import { useEffect, useState, useCallback, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getToken } from "../../../../lib/auth";
import {
    createSignTask,
    listAccounts,
    getAccountChats,
    searchAccountChats,
    AccountInfo,
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

type AccountScheduleRow = {
    account_name: string;
    selected: boolean;
    execution_mode: ScheduleMode;
    fixed_time: string;
    range_start: string;
    range_end: string;
};

const padTimePart = (value: number) => value.toString().padStart(2, "0");

const addMinutesToClock = (value: string, minutesToAdd: number) => {
    const [rawHour, rawMinute] = value.split(":");
    const hour = Number(rawHour);
    const minute = Number(rawMinute);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
        return value;
    }
    const totalMinutes = (((hour * 60 + minute + minutesToAdd) % 1440) + 1440) % 1440;
    return `${padTimePart(Math.floor(totalMinutes / 60))}:${padTimePart(totalMinutes % 60)}`;
};

const fixedTimeToCron = (value: string) => {
    const [rawHour, rawMinute] = value.split(":");
    const hour = Number(rawHour);
    const minute = Number(rawMinute);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
        return "";
    }
    return `0 ${minute} ${hour} * * *`;
};

function CreateSignTaskContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const fromParam = parseTaskFormFrom(searchParams.get("from"));
    const accountParam = (searchParams.get("account") || "").trim();
    const { t } = useLanguage();
    const { toasts, addToast, removeToast } = useToast();
    const [token, setLocalToken] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const loadedAccountsTokenRef = useRef<string | null>(null);

    // 表单数据
    const [taskName, setTaskName] = useState("");
    const [executionMode, setExecutionMode] = useState<"fixed" | "range">("range");
    const [signAt, setSignAt] = useState("06:00");
    const [rangeStart, setRangeStart] = useState("09:00");
    const [rangeEnd, setRangeEnd] = useState("18:00");
    const [randomSeconds, setRandomSeconds] = useState(0);
    const [signInterval, setSignInterval] = useState(1);
    const [chats, setChats] = useState<SignTaskChat[]>([]);

    // 账号和 Chat 数据
    const [accounts, setAccounts] = useState<AccountInfo[]>([]);
    const [selectedAccount, setSelectedAccount] = useState("");
    const [accountSchedules, setAccountSchedules] = useState<AccountScheduleRow[]>([]);
    const [staggerMinutes, setStaggerMinutes] = useState(5);
    const [availableChats, setAvailableChats] = useState<ChatInfo[]>([]);
    const [loadingChats, setLoadingChats] = useState(false);
    const [refreshingChats, setRefreshingChats] = useState(false);
    const [chatSearch, setChatSearch] = useState("");
    const [chatSearchResults, setChatSearchResults] = useState<ChatInfo[]>([]);
    const [chatSearchLoading, setChatSearchLoading] = useState(false);

    // 当前编辑的 Chat
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

    const resetForm = useCallback(() => {
        setTaskName("");
        setExecutionMode("range");
        setSignAt("06:00");
        setRangeStart("09:00");
        setRangeEnd("18:00");
        setRandomSeconds(0);
        setSignInterval(1);
        setChats([]);
        setEditingChat(null);
        setChatSearch("");
        setChatSearchResults([]);
        setChatSearchLoading(false);
    }, []);

    const goBack = useCallback(() => {
        router.push(resolveTaskFormReturnPath(fromParam, accountParam || selectedAccount));
    }, [router, fromParam, accountParam, selectedAccount]);

    const handleCancel = useCallback(() => {
        resetForm();
        goBack();
    }, [resetForm, goBack]);

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

    const loadAccounts = useCallback(async (tokenStr: string) => {
        try {
            const data = await listAccounts(tokenStr);
            setAccounts(data.accounts);

            const matched = accountParam
                ? data.accounts.find((a) => a.name === accountParam)
                : undefined;
            const defaultName = matched
                ? matched.name
                : (data.accounts[0]?.name || "");

            setAccountSchedules(data.accounts.map((account) => ({
                account_name: account.name,
                selected: matched
                    ? account.name === matched.name
                    : account.name === data.accounts[0]?.name,
                execution_mode: "range",
                fixed_time: "06:00",
                range_start: "09:00",
                range_end: "18:00",
            })));

            if (defaultName) {
                setSelectedAccount(defaultName);
                loadChats(tokenStr, defaultName);
            }
        } catch (err: any) {
            addToast(formatErrorMessage("load_failed", err), "error");
        }
    }, [addToast, loadChats, formatErrorMessage, accountParam]);

    useEffect(() => {
        const tokenStr = getToken();
        if (!tokenStr) {
            router.replace("/");
            return;
        }
        setLocalToken(tokenStr);
        if (loadedAccountsTokenRef.current === tokenStr) return;
        loadedAccountsTokenRef.current = tokenStr;
        loadAccounts(tokenStr);
    }, [router, loadAccounts]);

    const handleAccountChange = (accountName: string) => {
        setSelectedAccount(accountName);
        setAvailableChats([]);
        setChatSearch("");
        setChatSearchResults([]);
        setChatSearchLoading(false);
        if (token) {
            loadChats(token, accountName);
        }
    };

    useEffect(() => {
        if (!token || !selectedAccount) return;
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
                const res = await searchAccountChats(token, selectedAccount, query, 50, 0);
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
    }, [chatSearch, token, selectedAccount, addToast, formatErrorMessage, handleAccountSessionInvalid]);

    useEffect(() => {
        if (!editingChat) {
            setChatSearch("");
            setChatSearchResults([]);
            setChatSearchLoading(false);
        }
    }, [editingChat, selectedAccount]);

    const handleAddChat = () => {
        setEditingChat(createEmptyEditingChat());
    };

    const handleRefreshChats = async () => {
        if (!token || !selectedAccount) return;
        try {
            setRefreshingChats(true);
            await loadChats(token, selectedAccount, true);
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

    const selectedAccountCount = accountSchedules.filter(row => row.selected).length;

    const updateAccountSchedule = (
        accountName: string,
        updater: (row: AccountScheduleRow) => AccountScheduleRow
    ) => {
        setAccountSchedules(prev => prev.map(row => (
            row.account_name === accountName ? updater(row) : row
        )));
    };

    const setAllAccountsSelected = (selected: boolean) => {
        setAccountSchedules(prev => prev.map(row => ({ ...row, selected })));
    };

    const applyStaggerRule = () => {
        const selectedNames = accountSchedules
            .filter(row => row.selected)
            .map(row => row.account_name);
        const selectedNameSet = new Set(selectedNames);
        const interval = Number.isFinite(staggerMinutes) ? staggerMinutes : 0;

        setAccountSchedules(prev => {
            let selectedIndex = 0;
            return prev.map(row => {
                if (!selectedNameSet.has(row.account_name)) return row;
                const offset = selectedIndex * interval;
                selectedIndex += 1;
                if (executionMode === "fixed") {
                    return {
                        ...row,
                        execution_mode: "fixed",
                        fixed_time: addMinutesToClock(signAt, offset),
                    };
                }
                return {
                    ...row,
                    execution_mode: "range",
                    range_start: addMinutesToClock(rangeStart, offset),
                    range_end: addMinutesToClock(rangeEnd, offset),
                };
            });
        });
    };

    const handleSubmit = async () => {
        if (!token) return;
        if (!taskName) {
            addToast(t("task_name_required"), "error");
            return;
        }
        const selectedSchedules = accountSchedules.filter(row => row.selected);
        if (selectedSchedules.length === 0) {
            addToast(t("no_account_selected"), "error");
            return;
        }
        if (selectedSchedules.some(row => row.execution_mode === "fixed" && !row.fixed_time)) {
            addToast(t("fixed_time_required"), "error");
            return;
        }
        if (selectedSchedules.some(row => row.execution_mode === "range" && (!row.range_start || !row.range_end))) {
            addToast(t("range_required"), "error");
            return;
        }
        if (chats.length === 0) {
            addToast(t("chat_required"), "error");
            return;
        }

        try {
            setLoading(true);
            const errors: string[] = [];
            let created = 0;
            const normalizedChats = chats.map((c) => normalizeChatInterval(c));

            for (const schedule of selectedSchedules) {
                try {
                    const fixedCron = schedule.execution_mode === "fixed"
                        ? fixedTimeToCron(schedule.fixed_time)
                        : "0 0 * * *";
                    if (schedule.execution_mode === "fixed" && !fixedCron) {
                        errors.push(`${schedule.account_name}: ${t("fixed_time_required")}`);
                        continue;
                    }
                    await createSignTask(token, {
                        name: taskName,
                        account_name: schedule.account_name,
                        sign_at: fixedCron,
                        chats: normalizedChats,
                        random_seconds: randomSeconds,
                        sign_interval: signInterval,
                        execution_mode: schedule.execution_mode,
                        range_start: schedule.range_start,
                        range_end: schedule.range_end,
                    });
                    created += 1;
                } catch (err: any) {
                    errors.push(`${schedule.account_name}: ${err?.message || t("create_failed")}`);
                }
            }

            if (errors.length > 0) {
                const summary = errors.slice(0, 3).join("; ");
                addToast(
                    t("create_batch_partial")
                        .replace("{created}", String(created))
                        .replace("{failed}", String(errors.length))
                        .replace("{errors}", summary),
                    "error"
                );
            } else {
                addToast(t("create_batch_success").replace("{count}", String(created)), "success");
                setTimeout(() => goBack(), 1000);
            }
        } catch (err: any) {
            addToast(formatErrorMessage("create_failed", err), "error");
        } finally {
            setLoading(false);
        }
    };

    if (!token) return null;

    return (
        <div id="create-task-view" className="w-full h-full flex flex-col pt-[72px]">
            <nav className="navbar fixed top-0 left-0 right-0 z-50 h-[72px] px-5 md:px-10 flex justify-between items-center glass-panel rounded-none border-x-0 border-t-0 bg-white/2 dark:bg-black/5">
                <div className="flex items-center gap-4">
                    <button onClick={handleCancel} className="action-btn" title={t("cancel")}>
                        <CaretLeft weight="bold" />
                    </button>
                    <div className="flex items-center gap-2 text-sm font-medium">
                        <span className="text-main/40 uppercase tracking-widest text-[10px]">{t("sidebar_tasks")}</span>
                        <span className="text-main/20">/</span>
                        <span className="text-main uppercase tracking-widest text-[10px]">{t("add_task")}</span>
                    </div>
                </div>
                <div className="flex items-center gap-4">
                    <ThemeLanguageToggle />
                </div>
            </nav>

            <main className="flex-1 p-5 md:p-10 w-full max-w-[900px] mx-auto overflow-y-auto animate-float-up pb-20">
                <header className="mb-10">
                    <h1 className="text-3xl font-bold tracking-tight mb-2">{t("task_center")}</h1>
                    <p className="text-[#9496a1] text-sm">{t("task_center_desc")}</p>
                </header>

                <div className="grid gap-8">
                    {/* 基本配置 */}
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
                                <label className="text-xs font-bold text-main/40 uppercase tracking-wider">{t("template_account")}</label>
                                <select
                                    className="!mb-0"
                                    value={selectedAccount}
                                    onChange={(e) => handleAccountChange(e.target.value)}
                                >
                                    {accounts.map(acc => <option key={acc.name} value={acc.name}>{acc.name}</option>)}
                                </select>
                                <p className="text-[10px] text-main/30">{t("template_account_hint")}</p>
                            </div>
                        </div>

                        <div className="p-4 glass-panel !bg-black/5 space-y-4 border-white/5">
                            <div className="flex items-center justify-between mb-4">
                                <label className="text-xs font-bold text-main/40 uppercase tracking-wider">
                                    {t("offset_rule")}
                                </label>
                                <div className="text-xs font-bold text-[#8a3ffc] bg-[#8a3ffc]/10 px-2 py-1 rounded">
                                    {selectedAccountCount} {t("selected_accounts")}
                                </div>
                            </div>

                            <p className="text-xs text-[#9496a1] mb-4">
                                {t("schedule_hint")}
                            </p>

                            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 animate-fade-in">
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
                                <div className="space-y-2">
                                    <label className="text-xs font-bold text-main/40 uppercase tracking-wider">{t("stagger_minutes")}</label>
                                    <input
                                        type="number"
                                        min={0}
                                        className="!mb-0"
                                        value={staggerMinutes}
                                        onChange={(e) => setStaggerMinutes(Math.max(0, Number(e.target.value) || 0))}
                                    />
                                </div>
                            </div>

                            <button type="button" onClick={applyStaggerRule} className="btn-secondary !h-9 !px-4 !text-[11px]">
                                {t("apply_stagger")}
                            </button>
                        </div>
                    </section>

                    <section className="glass-panel p-6 space-y-5">
                        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-[#8a3ffc]/10 rounded-lg text-[#b57dff]">
                                    <Clock weight="fill" size={18} />
                                </div>
                                <div>
                                    <h2 className="text-lg font-bold">{t("account_schedule")}</h2>
                                    <p className="text-xs text-main/40">{t("per_account_schedule")}</p>
                                </div>
                            </div>
                            <div className="flex gap-2">
                                <button type="button" onClick={() => setAllAccountsSelected(true)} className="btn-secondary !h-8 !px-3 !text-[10px]">
                                    {t("select_all")}
                                </button>
                                <button type="button" onClick={() => setAllAccountsSelected(false)} className="btn-secondary !h-8 !px-3 !text-[10px]">
                                    {t("clear_selection")}
                                </button>
                            </div>
                        </div>

                        {accountSchedules.length === 0 ? (
                            <div className="py-8 text-center border-2 border-dashed border-white/5 rounded-2xl text-main/30 text-sm">
                                {t("task_center_no_accounts")}
                            </div>
                        ) : (
                            <div className="overflow-x-auto rounded-xl border border-white/5">
                                <table className="w-full min-w-[720px] text-xs">
                                    <thead className="bg-black/10 text-main/40 uppercase tracking-wider">
                                        <tr>
                                            <th className="text-left p-3 w-12"></th>
                                            <th className="text-left p-3">{t("account")}</th>
                                            <th className="text-left p-3">{t("mode")}</th>
                                            <th className="text-left p-3">{t("trigger")}</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {accountSchedules.map((row) => (
                                            <tr key={row.account_name} className="border-t border-white/5">
                                                <td className="p-3">
                                                    <input
                                                        type="checkbox"
                                                        checked={row.selected}
                                                        onChange={(e) => updateAccountSchedule(row.account_name, item => ({ ...item, selected: e.target.checked }))}
                                                        className="w-4 h-4"
                                                    />
                                                </td>
                                                <td className="p-3 font-bold">{row.account_name}</td>
                                                <td className="p-3">
                                                    <select
                                                        className="!mb-0 !h-9"
                                                        value={row.execution_mode}
                                                        disabled={!row.selected}
                                                        onChange={(e) => updateAccountSchedule(row.account_name, item => ({ ...item, execution_mode: e.target.value as ScheduleMode }))}
                                                    >
                                                        <option value="range">{t("random_range_recommend")}</option>
                                                        <option value="fixed">{t("fixed_time")}</option>
                                                    </select>
                                                </td>
                                                <td className="p-3">
                                                    {row.execution_mode === "fixed" ? (
                                                        <input
                                                            type="time"
                                                            className="!mb-0 !h-9"
                                                            value={row.fixed_time}
                                                            disabled={!row.selected}
                                                            onChange={(e) => updateAccountSchedule(row.account_name, item => ({ ...item, fixed_time: e.target.value }))}
                                                        />
                                                    ) : (
                                                        <div className="grid grid-cols-2 gap-2">
                                                            <input
                                                                type="time"
                                                                className="!mb-0 !h-9"
                                                                value={row.range_start}
                                                                disabled={!row.selected}
                                                                onChange={(e) => updateAccountSchedule(row.account_name, item => ({ ...item, range_start: e.target.value }))}
                                                            />
                                                            <input
                                                                type="time"
                                                                className="!mb-0 !h-9"
                                                                value={row.range_end}
                                                                disabled={!row.selected}
                                                                onChange={(e) => updateAccountSchedule(row.account_name, item => ({ ...item, range_end: e.target.value }))}
                                                            />
                                                        </div>
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
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
                            {loading ? <Spinner className="animate-spin mx-auto" weight="bold" /> : t("deploy_task")}
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

export default function CreateSignTaskPage() {
    const { t } = useLanguage();
    return (
        <Suspense fallback={<div className="min-h-screen flex items-center justify-center">{t("loading")}</div>}>
            <CreateSignTaskContent />
        </Suspense>
    );
}
