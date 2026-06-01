"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
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
    CaretLeft,
    Plus,
    X,
    ChatCircleText,
    Clock,
    Trash,
    Spinner,
    DiceFive,
    Robot,
    MathOperations,
    Lightning,
    Check,
    ArrowClockwise
} from "@phosphor-icons/react";
import { ThemeLanguageToggle } from "../../../../components/ThemeLanguageToggle";
import { useLanguage } from "../../../../context/LanguageContext";
import { ToastContainer, useToast } from "../../../../components/ui/toast";

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

export default function CreateSignTaskPage() {
    const router = useRouter();
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

    const handleCancel = useCallback(() => {
        resetForm();
        window.location.href = "/dashboard";
    }, [resetForm]);

    // 当前编辑的 Chat
    const [editingChat, setEditingChat] = useState<{
        chat_id: number;
        name: string;
        manual_chat_id: string;
        actions: any[];
        delete_after?: number;
        action_interval: number;
    } | null>(null);

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
            setAccountSchedules(data.accounts.map((account, index) => ({
                account_name: account.name,
                selected: index === 0,
                execution_mode: "range",
                fixed_time: "06:00",
                range_start: "09:00",
                range_end: "18:00",
            })));
            if (data.accounts.length > 0) {
                setSelectedAccount(data.accounts[0].name);
                loadChats(tokenStr, data.accounts[0].name);
            }
        } catch (err: any) {
            addToast(formatErrorMessage("load_failed", err), "error");
        }
    }, [addToast, loadChats, formatErrorMessage]);

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
    }, [chatSearch, token, selectedAccount, addToast, t, formatErrorMessage, handleAccountSessionInvalid]);

    useEffect(() => {
        if (!editingChat) {
            setChatSearch("");
            setChatSearchResults([]);
            setChatSearchLoading(false);
        }
    }, [editingChat, selectedAccount]);

    const handleAddChat = () => {
        setEditingChat({
            chat_id: 0,
            name: "",
            manual_chat_id: "",
            actions: [],
            action_interval: 1000,
        });
    };

    const applyChatSelection = (chatId: number, chatName: string) => {
        if (!editingChat) return;
        setEditingChat({
            ...editingChat,
            chat_id: chatId,
            manual_chat_id: chatId !== 0 ? String(chatId) : "",
            name: chatName,
        });
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
        if (editingChat.actions.length === 0) {
            addToast(t("add_action_error"), "error");
            return;
        }
        const { manual_chat_id: _manualChatId, ...chatConfig } = editingChat;
        setChats([
            ...chats,
            {
                ...chatConfig,
                chat_id: resolvedChatId,
                name: chatConfig.name || `chat_${resolvedChatId}`,
            },
        ]);
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
                        chats: chats,
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
                setTimeout(() => router.push("/dashboard/sign-tasks"), 1000);
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

                    {/* Chat 配置 */}
                    <section className="glass-panel p-6 space-y-6">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-[#8a3ffc]/10 rounded-lg text-[#b57dff]">
                                    <ChatCircleText weight="fill" size={18} />
                                </div>
                                <h2 className="text-lg font-bold">{t("target_chat_config")} ({chats.length})</h2>
                            </div>
                            <button onClick={handleAddChat} className="btn-secondary !h-8 !px-3 font-bold !text-[10px]">
                                + {t("add_chat")}
                            </button>
                        </div>

                        {
                            chats.length === 0 ? (
                                <div className="py-10 text-center border-2 border-dashed border-white/5 rounded-2xl text-main/20">
                                    <p className="text-sm">{t("no_target_chat")}</p>
                                </div>
                            ) : (
                                <div className="flex flex-col gap-3">
                                    {chats.map((chat, idx) => (
                                        <div key={idx} className="glass-panel !bg-black/5 p-4 flex items-center justify-between group">
                                            <div className="flex items-center gap-4">
                                                <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center font-bold text-xs">
                                                    {idx + 1}
                                                </div>
                                                <div>
                                                    <div className="font-bold text-sm">{chat.name}</div>
                                                    <div className="text-[10px] text-main/30 font-mono mt-0.5">
                                                        {t("id_label")}: {chat.chat_id} | <span className="text-[#8a3ffc]/60 font-bold">{chat.actions.length} {t("actions_count")}</span>
                                                    </div>
                                                </div>
                                            </div>
                                            <button
                                                onClick={() => setChats(chats.filter((_, i) => i !== idx))}
                                                className="action-btn status-action-danger"
                                            >
                                                <Trash weight="bold" />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )
                        }
                    </section>

                    <div className="flex gap-4 pt-4">
                        <button onClick={handleCancel} className="btn-secondary flex-1">{t("cancel")}</button>
                        <button onClick={handleSubmit} disabled={loading} className="btn-gradient flex-1">
                            {loading ? <Spinner className="animate-spin mx-auto" weight="bold" /> : t("deploy_task")}
                        </button>
                    </div>
                </div>
            </main>

            {/* Editing Dialog */}
            {
                editingChat && (
                    <div className="modal-overlay active fixed inset-0 z-[100] flex items-center justify-center p-4">
                        <div className="glass-panel modal-content w-full max-w-lg animate-scale-in flex flex-col overflow-hidden">
                            <header className="p-6 border-b border-white/5 flex justify-between items-center bg-black/5">
                                <h2 className="text-xl font-bold flex items-center gap-3">
                                    <div className="p-2 bg-[#8a3ffc]/10 rounded-lg text-[#b57dff]">
                                        <Plus weight="bold" size={20} />
                                    </div>
                                    {t("configure_target_chat")}
                                </h2>
                                <button onClick={() => setEditingChat(null)} className="action-btn !w-8 !h-8">
                                    <X weight="bold" />
                                </button>
                            </header>

                            <div className="p-6 space-y-6">
                                <div className="space-y-2">
                                    <label className="text-xs uppercase tracking-widest font-bold text-main/40">{t("select_target_chat")}</label>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                            <label className="text-[10px] text-main/40 uppercase tracking-wider">{t("search_chat")}</label>
                                            <input
                                                className="!mb-0"
                                                placeholder={t("search_chat_placeholder")}
                                                value={chatSearch}
                                                onChange={(e) => setChatSearch(e.target.value)}
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
                                                                            setChatSearch("");
                                                                            setChatSearchResults([]);
                                                                        }}
                                                                    >
                                                                        <div className="text-sm font-semibold truncate">{title}</div>
                                                                        <div className="text-[10px] text-main/40 font-mono truncate">
                                                                            {chat.id}{chat.username ? ` · @${chat.username}` : ""}
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
                                                <label className="text-[10px] text-main/40 uppercase tracking-wider">{t("select_from_list")}</label>
                                                <button
                                                    type="button"
                                                    onClick={handleRefreshChats}
                                                    disabled={refreshingChats || loadingChats}
                                                    className="text-[10px] text-[#8a3ffc] hover:text-[#8a3ffc]/80 transition-colors uppercase font-bold tracking-tighter flex items-center gap-1"
                                                    title={t("refresh_chat_title")}
                                                >
                                                    {(refreshingChats || loadingChats) ? (
                                                        <Spinner className="animate-spin" size={12} />
                                                    ) : <ArrowClockwise weight="bold" size={12} />}
                                                    {t("refresh_list")}
                                                </button>
                                            </div>
                                            <select
                                                className="!mb-0"
                                                value={editingChat.chat_id}
                                                disabled={loadingChats}
                                                onChange={(e) => {
                                                    const cid = parseInt(e.target.value);
                                                    const chat = availableChats.find(c => c.id === cid);
                                                    applyChatSelection(cid, chat?.title || chat?.username || "");
                                                }}
                                            >
                                                <option value={0}>
                                                    {loadingChats ? t("loading") : t("select_chat_placeholder")}
                                                </option>
                                                {availableChats.map(c => <option key={c.id} value={c.id}>{c.title || c.username || c.id}</option>)}
                                            </select>
                                        </div>
                                        <div className="space-y-2 md:col-span-2">
                                            <label className="text-[10px] text-main/40 uppercase tracking-wider">{t("manual_chat_id")}</label>
                                            <input
                                                className="!mb-0"
                                                placeholder={t("manual_id_placeholder")}
                                                value={editingChat.manual_chat_id}
                                                onChange={(e) => {
                                                    setEditingChat({
                                                        ...editingChat,
                                                        chat_id: 0,
                                                        manual_chat_id: e.target.value,
                                                        name: e.target.value.trim() ? `chat_${e.target.value.trim()}` : editingChat.name,
                                                    });
                                                }}
                                            />
                                        </div>
                                    </div>
                                </div>

                                <div className="space-y-4">
                                    <div className="flex items-center justify-between">
                                        <label className="text-xs uppercase tracking-widest font-bold text-main/40">{t("action_sequence_title")}</label>
                                        <button
                                            onClick={() => setEditingChat({ ...editingChat, actions: [...editingChat.actions, { action: 1, text: "" }] })}
                                            className="text-[10px] font-bold text-[#8a3ffc] hover:underline"
                                        >
                                            + {t("add_sign_action")}
                                        </button>
                                    </div>

                                    <div className="max-h-[200px] overflow-y-auto space-y-3 custom-scrollbar pr-2">
                                        {editingChat.actions.map((act, i) => (
                                            <div key={i} className="flex gap-3 items-center animate-scale-in">
                                                <div className="w-6 h-6 rounded-lg bg-white/5 flex items-center justify-center text-[10px] font-bold text-main/30">
                                                    {i + 1}
                                                </div>
                                                <input
                                                    className="!h-9 !text-sm"
                                                    value={act.text}
                                                    onChange={(e) => {
                                                        const newActs = [...editingChat.actions];
                                                        newActs[i] = { ...newActs[i], text: e.target.value };
                                                        setEditingChat({ ...editingChat, actions: newActs });
                                                    }}
                                                />
                                                <button
                                                    onClick={() => {
                                                        const newActs = editingChat.actions.filter((_, idx) => idx !== i);
                                                        setEditingChat({ ...editingChat, actions: newActs });
                                                    }}
                                                    className="action-btn !w-9 !h-9 status-action-danger"
                                                >
                                                    <X weight="bold" />
                                                </button>
                                            </div>
                                        ))}
                                        {editingChat.actions.length === 0 && (
                                            <div className="text-center py-4 text-xs text-main/20 italic">
                                                {t("no_actions_hint")}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <footer className="p-6 border-t border-white/5 flex gap-4 bg-black/10">
                                <button onClick={() => setEditingChat(null)} className="btn-secondary flex-1">{t("cancel")}</button>
                                <button onClick={handleSaveChat} className="btn-gradient flex-1 flex items-center justify-center gap-2">
                                    <Check weight="bold" />
                                    {t("confirm_add")}
                                </button>
                            </footer>
                        </div>
                    </div>
                )
            }

            <ToastContainer toasts={toasts} removeToast={removeToast} />
        </div >
    );
}
