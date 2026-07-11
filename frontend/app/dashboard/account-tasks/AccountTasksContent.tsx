"use client";

import { useEffect, useState, memo, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { getToken } from "../../../lib/auth";
import {
    listSignTasks,
    deleteSignTask,
    deleteSignTasksBatch,
    runSignTask,
    getSignTaskHistory,
    exportSignTask,
    importSignTask,
    exportSignTasks,
    importSignTasks,
    SignTask,
    SignTaskHistoryItem,
    SignTaskMessageEvent,
} from "../../../lib/api";
import {
    buildCreateTaskPath,
    buildEditTaskPath,
} from "../../../lib/task-form-nav";
import {
    CaretLeft,
    Plus,
    Play,
    PencilSimple,
    Trash,
    Spinner,
    Clock,
    CheckCircle,
    XCircle,
    Hourglass,
    ArrowClockwise,
    ListDashes,
    X,
    Lightning,
    Copy,
    ClipboardText,
    Export,
    CheckSquare,
    Square,
} from "@phosphor-icons/react";
import { ToastContainer, useToast } from "../../../components/ui/toast";
import { TaskBatchActionsBar } from "../../../components/TaskBatchActionsBar";
import { SignTaskFlowLogLine } from "../../../components/SignTaskFlowLogLine";
import { useLanguage } from "../../../context/LanguageContext";

const isDuplicateRunMessage = (message?: string) => {
    const text = String(message || "");
    return text.includes("运行中") || text.includes("执行中") || text.includes("重复触发");
};

// Memoized Task Item Component
const TaskItem = memo(({ task, loading, isRunning, isSelected, selectionMode, onToggleSelection, onEdit, onRun, onViewLogs, onCopy, onDelete, t, language }: {
    task: SignTask;
    loading: boolean;
    isRunning?: boolean;
    isSelected?: boolean;
    selectionMode?: boolean;
    onToggleSelection?: () => void;
    onEdit: (task: SignTask) => void;
    onRun: (name: string) => void;
    onViewLogs: (task: SignTask) => void;
    onCopy: (name: string) => void;
    onDelete: (name: string) => void;
    t: (key: string) => string;
    language: string;
}) => {
    const copyTaskTitle = language === "zh" ? "\u590D\u5236\u4EFB\u52A1" : "Copy Task";

    return (
        <div className={`glass-panel p-4 md:p-5 group transition-all ${isRunning ? 'border-[#8a3ffc]/50' : isSelected ? 'border-[#8a3ffc]/60 bg-[#8a3ffc]/5' : 'hover:border-[#8a3ffc]/30'}`}>
            <div className="flex items-start gap-4 min-w-0">
                {selectionMode && onToggleSelection && (
                    <button onClick={onToggleSelection} className="mt-2">
                        {isSelected ? (
                            <CheckSquare weight="fill" size={20} className="text-[#8a3ffc]" />
                        ) : (
                            <Square weight="bold" size={20} />
                        )}
                    </button>
                )}
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-[#b57dff] shrink-0 ${isRunning ? 'bg-[#8a3ffc]/25' : 'bg-[#8a3ffc]/15'}`}>
                    {isRunning
                        ? <Spinner weight="bold" size={20} className="animate-spin" />
                        : <Lightning weight="fill" size={20} />}
                </div>
                <div className="min-w-0 flex-1 flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                        <h3 className="font-bold truncate text-sm" title={task.name}>{task.name}</h3>
                        <span className="text-[9px] font-mono text-main/30 bg-white/5 px-1.5 py-0.5 rounded border border-white/5">
                            {t("target_chats_count").replace("{count}", String(task.chats?.length || 0))}
                        </span>
                        {(task.chats?.[0]?.name || task.chats?.[0]?.chat_id) ? (
                            <span className="text-[9px] text-main/30 truncate max-w-[120px]" title={String(task.chats?.[0]?.name || task.chats?.[0]?.chat_id || "")}>
                                {task.chats?.[0]?.name || task.chats?.[0]?.chat_id}
                            </span>
                        ) : null}
                        {isRunning && (
                            <span className="text-[9px] font-bold text-[#8a3ffc] animate-pulse uppercase tracking-wider">
                                {t("task_running")}
                            </span>
                        )}
                    </div>
                    <div className="flex items-center gap-3">
                        <div className="flex items-center gap-1.5 text-main/40">
                            <Clock weight="bold" size={12} />
                            <span className="text-[10px] font-bold font-mono uppercase tracking-wider">
                                {task.execution_mode === "range" && task.range_start && task.range_end
                                    ? `${task.range_start} - ${task.range_end}`
                                    : task.sign_at}
                            </span>
                        </div>
                        {task.random_seconds > 0 && (
                            <div className="flex items-center gap-1 text-[#8a3ffc]/60">
                                <Hourglass weight="bold" size={12} />
                                <span className="text-[10px] font-bold">~{Math.round(task.random_seconds / 60)}m</span>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <div className="mt-3 md:hidden">
                {task.last_run ? (
                    <div className="text-[10px] font-mono ui-muted flex items-center gap-2 pt-2 border-t border-white/5">
                        <span className={task.last_run.success ? "status-text-success" : "status-text-danger"}>
                            {task.last_run.success ? t("success") : t("failure")}
                        </span>
                        <span>
                            {new Date(task.last_run.time).toLocaleString(language === "zh" ? 'zh-CN' : 'en-US', {
                                month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
                            })}
                        </span>
                    </div>
                ) : (
                    <div className="pt-2 border-t border-white/5 text-[10px] text-main/20 font-bold uppercase tracking-widest italic">{t("no_data")}</div>
                )}
            </div>

            <div className="mt-3 grid grid-cols-5 gap-2 md:hidden">
                <button
                    onClick={() => onRun(task.name)}
                    disabled={loading}
                    className="action-btn !w-full !h-10 status-action-success"
                    title={t("run")}
                >
                    <Play weight="fill" size={14} />
                </button>
                <button
                    onClick={() => onEdit(task)}
                    disabled={loading}
                    className="action-btn !w-full !h-10"
                    title={t("edit")}
                >
                    <PencilSimple weight="bold" size={14} />
                </button>
                <button
                    onClick={() => onViewLogs(task)}
                    disabled={loading}
                    className="action-btn !w-full !h-10 !text-[#8a3ffc] hover:bg-[#8a3ffc]/10"
                    title={t("task_history_logs")}
                >
                    <ListDashes weight="bold" size={14} />
                </button>
                <button
                    onClick={() => onCopy(task.name)}
                    disabled={loading}
                    className="action-btn !w-full !h-10 !text-sky-400 hover:bg-sky-500/10"
                    title={copyTaskTitle}
                >
                    <Copy weight="bold" size={14} />
                </button>
                <button
                    onClick={() => onDelete(task.name)}
                    disabled={loading}
                    className="action-btn !w-full !h-10 status-action-danger"
                    title={t("delete")}
                >
                    <Trash weight="bold" size={14} />
                </button>
            </div>

            <div className="hidden md:flex mt-4 items-center justify-between gap-4">
                {task.last_run ? (
                    <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest">
                        <div className={`flex items-center gap-1.5 ${task.last_run.success ? 'status-text-success' : 'status-text-danger'}`}>
                            {task.last_run.success ? <CheckCircle weight="bold" /> : <XCircle weight="bold" />}
                            {task.last_run.success ? t("success") : t("failure")}
                        </div>
                        <div className="text-[10px] ui-muted font-mono normal-case tracking-normal">
                            {new Date(task.last_run.time).toLocaleString(language === "zh" ? 'zh-CN' : 'en-US', {
                                month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
                            })}
                        </div>
                    </div>
                ) : (
                    <div className="text-[10px] text-main/20 font-bold uppercase tracking-widest italic">{t("no_data")}</div>
                )}

                <div className="flex items-center gap-1 bg-black/10 rounded-xl p-1 border border-white/5">
                    <button
                        onClick={() => onRun(task.name)}
                        disabled={loading}
                        className="action-btn !w-8 !h-8 status-action-success"
                        title={t("run")}
                    >
                        <Play weight="fill" size={14} />
                    </button>
                    <button
                        onClick={() => onEdit(task)}
                        disabled={loading}
                        className="action-btn !w-8 !h-8"
                        title={t("edit")}
                    >
                        <PencilSimple weight="bold" size={14} />
                    </button>
                    <button
                        onClick={() => onViewLogs(task)}
                        disabled={loading}
                        className="action-btn !w-8 !h-8 !text-[#8a3ffc] hover:bg-[#8a3ffc]/10"
                        title={t("task_history_logs")}
                    >
                        <ListDashes weight="bold" size={14} />
                    </button>
                    <button
                        onClick={() => onCopy(task.name)}
                        disabled={loading}
                        className="action-btn !w-8 !h-8 !text-sky-400 hover:bg-sky-500/10"
                        title={copyTaskTitle}
                    >
                        <Copy weight="bold" size={14} />
                    </button>
                    <button
                        onClick={() => onDelete(task.name)}
                        disabled={loading}
                        className="action-btn !w-8 !h-8 status-action-danger"
                        title={t("delete")}
                    >
                        <Trash weight="bold" size={14} />
                    </button>
                </div>
            </div>
        </div>
    );
});

TaskItem.displayName = "TaskItem";

export default function AccountTasksContent() {
    const router = useRouter();
    const { t, language } = useLanguage();
    const searchParams = useSearchParams();
    const accountName = searchParams.get("name") || "";
    const { toasts, addToast, removeToast } = useToast();
    const [token, setLocalToken] = useState<string | null>(null);
    const [tasks, setTasks] = useState<SignTask[]>([]);
    const [loading, setLoading] = useState(false);
    const [historyTaskName, setHistoryTaskName] = useState<string | null>(null);
    const [historyLogs, setHistoryLogs] = useState<SignTaskHistoryItem[]>([]);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [historyTab, setHistoryTab] = useState<"messages" | "logs">("messages");

    const addToastRef = useRef(addToast);
    const tRef = useRef(t);
    useEffect(() => {
        addToastRef.current = addToast;
        tRef.current = t;
    }, [addToast, t]);

    const formatErrorMessage = useCallback((key: string, err?: any) => {
        const base = tRef.current ? tRef.current(key) : key;
        const code = err?.code;
        return code ? `${base} (${code})` : base;
    }, []);
    const handleAccountSessionInvalid = useCallback((err: any) => {
        if (err?.code !== "ACCOUNT_SESSION_INVALID") return false;
        const toast = addToastRef.current;
        const message = tRef.current
            ? tRef.current("account_session_invalid")
            : "Account session expired, please login again";
        if (toast) {
            toast(message, "error");
        }
        setTimeout(() => {
            router.replace("/dashboard");
        }, 800);
        return true;
    }, [router]);

    const [copyTaskDialog, setCopyTaskDialog] = useState<{ taskName: string; config: string } | null>(null);
    const [showPasteDialog, setShowPasteDialog] = useState(false);
    const [pasteTaskConfigInput, setPasteTaskConfigInput] = useState("");
    const [copyingConfig, setCopyingConfig] = useState(false);
    const [importingPastedConfig, setImportingPastedConfig] = useState(false);
    const [batchImportOverwrite, setBatchImportOverwrite] = useState(false);

    // 批量操作状态
    const [selectionMode, setSelectionMode] = useState(false);
    const [selectedTasks, setSelectedTasks] = useState<Set<string>>(new Set());

    const [checking, setChecking] = useState(true);
    const [runningTaskName, setRunningTaskName] = useState<string | null>(null);
    const isZh = language === "zh";
    const pasteTaskTitle = isZh ? "\u7C98\u8D34\u5BFC\u5165\u4EFB\u52A1" : "Paste Tasks";
    const copyTaskDialogTitle = isZh ? "\u590D\u5236\u4EFB\u52A1\u914D\u7F6E" : "Copy Task Config";
    const copyTaskDialogDesc = isZh ? "\u4EE5\u4E0B\u662F\u4EFB\u52A1\u914D\u7F6E\uFF0C\u53EF\u624B\u52A8\u590D\u5236\u6216\u70B9\u51FB\u4E00\u952E\u590D\u5236\u3002" : "Task config is ready. Copy manually or use one-click copy.";
    const copyConfigAction = isZh ? "\u4E00\u952E\u590D\u5236" : "Copy";
    const pasteTaskDialogTitle = isZh ? "\u7C98\u8D34\u5BFC\u5165\u4EFB\u52A1" : "Paste Task Config";
    const pasteTaskDialogDesc = isZh ? "\u7C98\u8D34\u5355\u4E2A\u4EFB\u52A1\u6216\u3010\u6279\u91CF\u5BFC\u51FA\u5168\u90E8\u4EFB\u52A1\u3011\u5F97\u5230\u7684 JSON\uFF0C\u7CFB\u7EDF\u4F1A\u81EA\u52A8\u8BC6\u522B\u683C\u5F0F\u3002" : "Paste a single task JSON or the JSON from Export all tasks. The format is detected automatically.";
    const pasteTaskDialogPlaceholder = isZh ? "\u5728\u6B64\u7C98\u8D34\u5355\u4EFB\u52A1\u6216\u591A\u4EFB\u52A1 JSON..." : "Paste single-task or multi-task JSON here...";
    const importTaskAction = isZh ? "\u5BFC\u5165\u4EFB\u52A1" : "Import Task";
    const clipboardReadFailed = isZh ? "\u65E0\u6CD5\u8BFB\u53D6\u526A\u8D34\u677F\uFF0C\u5DF2\u5207\u6362\u4E3A\u624B\u52A8\u7C98\u8D34\u5BFC\u5165" : "Clipboard read failed, switched to manual paste import";
    const copyTaskSuccess = (taskName: string) =>
        isZh ? `\u4EFB\u52A1 ${taskName} \u5DF2\u590D\u5236\u5230\u526A\u8D34\u677F` : `Task ${taskName} copied to clipboard`;
    const copyTaskFailed = isZh ? "\u590D\u5236\u4EFB\u52A1\u5931\u8D25" : "Copy task failed";
    const pasteTaskSuccess = (taskName: string) =>
        isZh ? `\u4EFB\u52A1 ${taskName} \u5BFC\u5165\u6210\u529F` : `Task ${taskName} imported`;
    const pasteTaskFailed = isZh ? "\u7C98\u8D34\u4EFB\u52A1\u5931\u8D25" : "Paste task failed";
    const clipboardUnsupported = isZh ? "\u5F53\u524D\u73AF\u5883\u4E0D\u652F\u6301\u526A\u8D34\u677F\u64CD\u4F5C" : "Clipboard API is not available";

    const formatPartyLabel = useCallback((
        party?: { id?: number | null; username?: string; display_name?: string },
        fallback?: { id?: number | null; username?: string; display_name?: string },
        emptyLabel?: string,
    ) => {
        const id = party?.id ?? fallback?.id;
        const displayName = String(party?.display_name || fallback?.display_name || "").trim();
        const username = String(party?.username || fallback?.username || "").trim().replace(/^@/, "");

        if (displayName && username && id !== undefined && id !== null) {
            return `${displayName} (@${username}, ${id})`;
        }
        if (displayName && id !== undefined && id !== null && displayName !== String(id)) {
            return `${displayName} (${id})`;
        }
        if (username && id !== undefined && id !== null) {
            return `@${username} (${id})`;
        }
        if (displayName) return displayName;
        if (username) return `@${username}`;
        if (id !== undefined && id !== null) return String(id);
        return emptyLabel || t("unknown_sender");
    }, [t]);

    const describeMessageEvent = useCallback((event: SignTaskMessageEvent) => {
        const senderName = formatPartyLabel(event.sender, undefined, t("unknown_sender"));
        const recipientName = formatPartyLabel(
            event.recipient,
            {
                id: event.chat_id,
                username: event.chat_username,
                display_name: event.chat_title,
            },
            t("unknown_chat"),
        );
        const body = event.text || event.caption || event.summary || t("task_monitor_no_messages");
        const typeLabel = event.event_type === "message_sent"
            ? t("task_message_event_sent")
            : event.event_type === "message_edited"
                ? t("task_message_event_edited")
                : t("task_message_event_received");

        return {
            senderName: String(senderName),
            recipientName: String(recipientName),
            body,
            typeLabel,
        };
    }, [formatPartyLabel, t]);

    const loadData = useCallback(async (tokenStr: string) => {
        try {
            setLoading(true);
            const tasksData = await listSignTasks(tokenStr, accountName);
            setTasks(tasksData);
        } catch (err: any) {
            if (handleAccountSessionInvalid(err)) return;
            const toast = addToastRef.current;
            if (toast) {
                toast(formatErrorMessage("load_failed", err), "error");
            }
        } finally {
            setLoading(false);
        }
    }, [accountName, formatErrorMessage, handleAccountSessionInvalid]);

    useEffect(() => {
        const tokenStr = getToken();
        if (!tokenStr) {
            window.location.replace("/");
            return;
        }
        if (!accountName) {
            window.location.replace("/dashboard");
            return;
        }
        setLocalToken(tokenStr);
        setChecking(false);
        loadData(tokenStr);
    }, [accountName, loadData]);

    const handleDeleteTask = useCallback(async (taskName: string) => {
        if (!token) return;

        if (!confirm(tRef.current("confirm_delete"))) {
            return;
        }

        try {
            setLoading(true);
            await deleteSignTask(token, taskName, accountName);
            await loadData(token);
        } catch (err: any) {
            // 404 说明任务已不存在，刷新列表即可
            if (err.status !== 404) {
                addToastRef.current(formatErrorMessage("delete_failed", err), "error");
            } else {
                await loadData(token);
            }
        } finally {
            setLoading(false);
        }
    }, [token, accountName, loadData, formatErrorMessage]);

    // 批量操作函数
    const toggleTaskSelection = (taskName: string) => {
        setSelectedTasks(prev => {
            const newSet = new Set(prev);
            if (newSet.has(taskName)) {
                newSet.delete(taskName);
            } else {
                newSet.add(taskName);
            }
            return newSet;
        });
    };

    const toggleSelectAll = () => {
        if (selectedTasks.size === tasks.length) {
            setSelectedTasks(new Set());
        } else {
            setSelectedTasks(new Set(tasks.map(t => t.name)));
        }
    };

    const handleBatchDelete = async () => {
        if (!token || selectedTasks.size === 0) return;

        const confirmMsg = language === "zh"
            ? `确认删除 ${selectedTasks.size} 个任务？`
            : `Delete ${selectedTasks.size} tasks?`;

        if (!confirm(confirmMsg)) return;

        try {
            setLoading(true);
            const tasksToDelete = Array.from(selectedTasks).map(name => ({
                name,
                account_name: accountName,
            }));

            const result = await deleteSignTasksBatch(token, tasksToDelete);

            if (result.ok) {
                addToast(
                    language === "zh"
                        ? `成功删除 ${result.deleted} 个任务`
                        : `Successfully deleted ${result.deleted} tasks`,
                    "success"
                );
            } else {
                addToast(
                    language === "zh"
                        ? `删除完成：成功 ${result.deleted} 个，失败 ${result.failed} 个`
                        : `Deleted ${result.deleted} tasks, ${result.failed} failed`,
                    result.failed > 0 ? "error" : "success"
                );
            }

            setSelectedTasks(new Set());
            setSelectionMode(false);
            await loadData(token);
        } catch (err: any) {
            addToast(formatErrorMessage("delete_failed", err), "error");
        } finally {
            setLoading(false);
        }
    };

    const handleRunTask = useCallback(async (taskName: string) => {
        if (!token) return;

        try {
            setLoading(true);
            setRunningTaskName(taskName);
            const result = await runSignTask(token, taskName, accountName);

            if (result.accepted === false || result.status === "failed") {
                const duplicateMessage = result.message || result.error || "";
                if (isDuplicateRunMessage(duplicateMessage)) {
                    addToastRef.current(duplicateMessage || tRef.current("task_running_wait") || (language === "zh" ? "该任务正在执行中，请勿重复触发" : "Task is currently running, please wait until it finishes."), "info");
                } else {
                    addToastRef.current(result.error || tRef.current("task_run_failed"), "error");
                }
            } else {
                addToastRef.current(result.message || (language === "zh" ? "任务已提交后台执行" : "Task submitted to run in the background"), "success");
            }
        } catch (err: any) {
            if (err?.status === 409) {
                const duplicateMessage = err?.data?.message || err?.data?.error || err.message;
                addToastRef.current(duplicateMessage || (language === "zh" ? "该任务正在执行中，请勿重复触发" : "Task is already running."), "info");
            } else {
                addToastRef.current(formatErrorMessage("task_run_failed", err), "error");
            }
        } finally {
            setLoading(false);
            setRunningTaskName(null);
        }
    }, [token, accountName, language, formatErrorMessage]);

    const handleShowTaskHistory = useCallback(async (task: SignTask) => {
        if (!token) return;
        setHistoryTaskName(task.name);
        setHistoryLogs([]);
        setHistoryLoading(true);
        try {
            const logs = await getSignTaskHistory(token, task.name, accountName, 30);
            setHistoryLogs(logs);
            setHistoryTab(
                logs.some((item) => (item.message_events?.length || 0) > 0)
                    ? "messages"
                    : "logs"
            );
        } catch (err: any) {
            addToastRef.current(formatErrorMessage("logs_fetch_failed", err), "error");
        } finally {
            setHistoryLoading(false);
        }
    }, [token, accountName, formatErrorMessage]);

    const importTaskFromConfig = async (rawConfig: string): Promise<{ ok: boolean; error?: string }> => {
        if (!token) return { ok: false, error: "NO_TOKEN" };
        const taskConfig = (rawConfig || "").trim();
        if (!taskConfig) {
            addToast(t("import_empty"), "error");
            return { ok: false, error: t("import_empty") };
        }

        try {
            setLoading(true);
            let parsed: any = null;
            try {
                parsed = JSON.parse(taskConfig);
            } catch {
                parsed = null;
            }

            const isBatchConfig = Boolean(
                parsed &&
                typeof parsed === "object" &&
                (parsed.task_type === "sign-batch" || Array.isArray(parsed.tasks))
            );

            if (isBatchConfig) {
                const result = await importSignTasks(token, taskConfig, accountName, batchImportOverwrite);
                const importErrors = Array.isArray(result.errors) ? result.errors : [];
                if (importErrors.length > 0) {
                    const errorSummary = importErrors.slice(0, 3).join("; ");
                    addToast(
                        result.message ||
                        (isZh
                            ? `批量导入存在问题：${errorSummary}`
                            : `Batch import completed with errors: ${errorSummary}`),
                        "error"
                    );
                    await loadData(token);
                    return { ok: result.imported > 0, error: errorSummary };
                }
                addToast(result.message || (isZh ? "批量导入完成" : "Batch import done"), "success");
                await loadData(token);
                return { ok: true };
            }

            const result = await importSignTask(token, taskConfig, undefined, accountName);
            addToast(pasteTaskSuccess(result.task_name), "success");
            await loadData(token);
            return { ok: true };
        } catch (err: any) {
            const message = err?.message ? `${pasteTaskFailed}: ${err.message}` : pasteTaskFailed;
            addToast(message, "error");
            return { ok: false, error: message };
        } finally {
            setLoading(false);
        }
    };

    const handleCopyTask = useCallback(async (taskName: string) => {
        if (!token) return;
        const isZhLocal = language === "zh";
        const successMsg = (name: string) => isZhLocal ? `任务 ${name} 已复制到剪贴板` : `Task ${name} copied to clipboard`;
        const fallbackMsg = isZhLocal ? "自动复制失败，请在弹窗内手动复制" : "Auto copy failed, please copy manually from dialog";
        const failedBase = isZhLocal ? "复制任务失败" : "Copy task failed";

        try {
            setLoading(true);
            const taskConfig = await exportSignTask(token, taskName, accountName);
            if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
                try {
                    await navigator.clipboard.writeText(taskConfig);
                    addToastRef.current(successMsg(taskName), "success");
                    return;
                } catch {
                    addToastRef.current(fallbackMsg, "error");
                }
            }
            setCopyTaskDialog({ taskName, config: taskConfig });
        } catch (err: any) {
            const message = err?.message ? `${failedBase}: ${err.message}` : failedBase;
            addToastRef.current(message, "error");
        } finally {
            setLoading(false);
        }
    }, [token, accountName, language]);

    const handleCopyTaskConfig = async () => {
        if (!copyTaskDialog) return;
        setCopyingConfig(true);
        try {
            if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(copyTaskDialog.config);
            } else {
                // execCommand fallback for non-HTTPS environments
                const ta = document.createElement("textarea");
                ta.value = copyTaskDialog.config;
                ta.style.position = "fixed";
                ta.style.opacity = "0";
                document.body.appendChild(ta);
                ta.focus();
                ta.select();
                const ok = document.execCommand("copy");
                document.body.removeChild(ta);
                if (!ok) {
                    addToast(clipboardUnsupported, "error");
                    return;
                }
            }
            addToast(copyTaskSuccess(copyTaskDialog.taskName), "success");
            setCopyTaskDialog(null);
        } catch (err: any) {
            const message = err?.message ? `${copyTaskFailed}: ${err.message}` : copyTaskFailed;
            addToast(message, "error");
        } finally {
            setCopyingConfig(false);
        }
    };

    const handlePasteDialogImport = async () => {
        setImportingPastedConfig(true);
        const result = await importTaskFromConfig(pasteTaskConfigInput);
        if (result.ok) {
            setShowPasteDialog(false);
            setPasteTaskConfigInput("");
            setBatchImportOverwrite(false);
        }
        setImportingPastedConfig(false);
    };

    const handlePasteTask = async () => {
        if (!token) return;

        if (typeof navigator !== "undefined" && navigator.clipboard?.readText) {
            try {
                const taskConfig = (await navigator.clipboard.readText()).trim();
                if (taskConfig) {
                    const result = await importTaskFromConfig(taskConfig);
                    if (result.ok) {
                        return;
                    }
                    setPasteTaskConfigInput(taskConfig);
                    setShowPasteDialog(true);
                    return;
                }
            } catch {
                addToast(clipboardReadFailed, "error");
            }
        } else {
            addToast(clipboardUnsupported, "error");
        }

        setPasteTaskConfigInput("");
        setBatchImportOverwrite(false);
        setShowPasteDialog(true);
    };

    const closeCopyTaskDialog = () => {
        if (copyingConfig) {
            return;
        }
        setCopyTaskDialog(null);
    };

    const closePasteTaskDialog = () => {
        if (importingPastedConfig || loading) {
            return;
        }
        setShowPasteDialog(false);
        setPasteTaskConfigInput("");
        setBatchImportOverwrite(false);
    };

    const handleExportAllTasks = async () => {
        if (!token) return;
        try {
            setLoading(true);
            const config = await exportSignTasks(token, accountName);
            if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
                try {
                    await navigator.clipboard.writeText(config);
                    addToast(isZh ? "批量配置已复制到剪贴板" : "Batch config copied to clipboard", "success");
                    return;
                } catch {
                    // fall through to manual copy
                }
            }
            setCopyTaskDialog({ taskName: isZh ? `${accountName} (全部)` : `${accountName} (all)`, config });
        } catch (err: any) {
            addToast(
                err?.message
                    ? (isZh ? `导出失败：${err.message}` : `Export failed: ${err.message}`)
                    : (isZh ? "导出失败" : "Export failed"),
                "error"
            );
        } finally {
            setLoading(false);
        }
    };

    const openCreateTask = useCallback(() => {
        router.push(
            buildCreateTaskPath({ account: accountName, from: "account-tasks" })
        );
    }, [router, accountName]);

    const handleEditTask = useCallback((task: SignTask) => {
        router.push(
            buildEditTaskPath({
                account: accountName,
                name: task.name,
                from: "account-tasks",
            })
        );
    }, [router, accountName]);

    const handleRefresh = useCallback(async () => {
        if (!token) return;
        await loadData(token);
    }, [token, loadData]);

    if (!token || checking) {
        return null;
    }

    return (
        <div id="account-tasks-view" className="w-full h-full flex flex-col">
            <nav className="navbar">
                <div className="nav-brand">
                    <div className="flex items-center gap-4">
                        <Link href="/dashboard" className="action-btn !w-8 !h-8" title={t("sidebar_home")}>
                            <CaretLeft weight="bold" size={18} />
                        </Link>
                        <h1 className="text-lg font-bold tracking-tight">{accountName}</h1>
                    </div>
                </div>
                <div className="top-right-actions">
                    <button
                        onClick={handleRefresh}
                        disabled={loading}
                        className="action-btn !w-8 !h-8"
                        title={t("refresh_chats")}
                    >
                        <ArrowClockwise weight="bold" size={18} className={loading ? 'animate-spin' : ''} />
                    </button>
                    {!selectionMode && (
                        <>
                            <button
                                onClick={() => setSelectionMode(true)}
                                disabled={loading || tasks.length === 0}
                                className="action-btn !w-8 !h-8"
                                title={isZh ? "选择" : "Select"}
                            >
                                <CheckSquare weight="bold" size={18} />
                            </button>
                            <button
                                onClick={handleExportAllTasks}
                                disabled={loading}
                                className="action-btn !w-auto !h-8 !px-3 gap-1.5 !text-amber-400 hover:bg-amber-500/10"
                                title={isZh ? "批量导出全部任务" : "Export all tasks"}
                            >
                                <Export weight="bold" size={18} />
                                <span className="hidden sm:inline text-[10px] font-bold">{isZh ? "批量导出" : "Export"}</span>
                            </button>
                            <button
                                onClick={handlePasteTask}
                                disabled={loading}
                                className="action-btn !w-auto !h-8 !px-3 gap-1.5 !text-sky-400 hover:bg-sky-500/10"
                                title={pasteTaskTitle}
                            >
                                <ClipboardText weight="bold" size={18} />
                                <span className="hidden sm:inline text-[10px] font-bold">{isZh ? "粘贴导入" : "Paste"}</span>
                            </button>
                        </>
                    )}
                    <button onClick={openCreateTask} className="action-btn !w-8 !h-8 !text-[#8a3ffc] hover:bg-[#8a3ffc]/10" title={t("add_task")}>
                        <Plus weight="bold" size={18} />
                    </button>
                </div>
            </nav>

            <main className="main-content !pt-6">
                {selectionMode && (
                    <TaskBatchActionsBar
                        selectedCount={selectedTasks.size}
                        totalCount={tasks.length}
                        isAllSelected={selectedTasks.size === tasks.length && tasks.length > 0}
                        onSelectAll={toggleSelectAll}
                        onClearSelection={() => { setSelectionMode(false); setSelectedTasks(new Set()); }}
                        onBatchDelete={handleBatchDelete}
                        deleteLabel={isZh ? "批量删除" : "Delete"}
                        clearLabel={isZh ? "取消" : "Cancel"}
                        selectAllLabel={isZh ? "全选" : "Select All"}
                        selectedLabel={isZh ? "已选 {count}/{total}" : "Selected {count}/{total}"}
                    />
                )}

                {loading && tasks.length === 0 ? (
                    <div className="w-full py-20 flex flex-col items-center justify-center text-main/20">
                        <Spinner size={40} weight="bold" className="animate-spin mb-4" />
                        <p className="text-xs uppercase tracking-widest font-bold font-mono">{t("loading")}</p>
                    </div>
                ) : tasks.length === 0 ? (
                    <div className="glass-panel p-20 flex flex-col items-center text-center justify-center border-dashed border-2 group hover:border-[#8a3ffc]/30 transition-all cursor-pointer" onClick={openCreateTask}>
                        <div className="w-20 h-20 rounded-3xl bg-main/5 flex items-center justify-center text-main/20 mb-6 group-hover:scale-110 transition-transform group-hover:bg-[#8a3ffc]/10 group-hover:text-[#8a3ffc]">
                            <Plus size={40} weight="bold" />
                        </div>
                        <h3 className="text-xl font-bold mb-2">{t("no_tasks")}</h3>
                        <p className="text-sm text-[#9496a1]">{t("no_tasks_desc")}</p>
                    </div>
                ) : (
                    <div className="flex flex-col gap-3">
                        {tasks.map((task) => (
                            <TaskItem
                                key={task.name}
                                task={task}
                                loading={loading}
                                isRunning={runningTaskName === task.name}
                                isSelected={selectedTasks.has(task.name)}
                                selectionMode={selectionMode}
                                onToggleSelection={() => toggleTaskSelection(task.name)}
                                onEdit={handleEditTask}
                                onRun={handleRunTask}
                                onViewLogs={handleShowTaskHistory}
                                onCopy={handleCopyTask}
                                onDelete={handleDeleteTask}
                                t={t}
                                language={language}
                            />
                        ))}
                    </div>
                )}
            </main>


            {copyTaskDialog && (
                <div className="modal-overlay active">
                    <div className="glass-panel modal-content !max-w-5xl flex flex-col" onClick={(e) => e.stopPropagation()}>
                        <header className="modal-header border-b border-white/5 pb-3 mb-0">
                            <div className="modal-title flex items-center gap-2 !text-base">
                                <Copy weight="bold" size={18} />
                                {copyTaskDialogTitle}: {copyTaskDialog.taskName}
                            </div>
                            <button onClick={closeCopyTaskDialog} className="modal-close" disabled={copyingConfig}>
                                <X weight="bold" />
                            </button>
                        </header>
                        <div className="p-5 space-y-3">
                            <p className="text-xs text-main/60">{copyTaskDialogDesc}</p>
                            <textarea
                                className="w-full h-72 !mb-0 font-mono text-xs"
                                value={copyTaskDialog.config}
                                readOnly
                            />
                        </div>
                        <footer className="p-5 border-t border-white/5 flex gap-3">
                            <button
                                className="btn-secondary flex-1"
                                onClick={closeCopyTaskDialog}
                                disabled={copyingConfig}
                            >
                                {t("close")}
                            </button>
                            <button
                                className="btn-gradient flex-1"
                                onClick={handleCopyTaskConfig}
                                disabled={copyingConfig}
                            >
                                {copyingConfig ? <Spinner className="animate-spin" /> : copyConfigAction}
                            </button>
                        </footer>
                    </div>
                </div>
            )}

            {showPasteDialog && (
                <div className="modal-overlay active">
                    <div className="glass-panel modal-content !max-w-5xl flex flex-col" onClick={(e) => e.stopPropagation()}>
                        <header className="modal-header border-b border-white/5 pb-3 mb-0">
                            <div className="modal-title flex items-center gap-2 !text-base">
                                <ClipboardText weight="bold" size={18} />
                                {pasteTaskDialogTitle}
                            </div>
                            <button onClick={closePasteTaskDialog} className="modal-close" disabled={importingPastedConfig || loading}>
                                <X weight="bold" />
                            </button>
                        </header>
                        <div className="p-5 space-y-3">
                            <p className="text-xs text-main/60">{pasteTaskDialogDesc}</p>
                            <textarea
                                className="w-full h-72 !mb-0 font-mono text-xs"
                                placeholder={pasteTaskDialogPlaceholder}
                                value={pasteTaskConfigInput}
                                onChange={(e) => setPasteTaskConfigInput(e.target.value)}
                            />
                            <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
                                <input
                                    type="checkbox"
                                    checked={batchImportOverwrite}
                                    onChange={(e) => setBatchImportOverwrite(e.target.checked)}
                                    disabled={importingPastedConfig || loading}
                                    className="w-4 h-4 rounded"
                                />
                                <span className="text-main/60">
                                    {isZh ? "多任务 JSON 导入时覆盖已存在的同名任务" : "Overwrite existing tasks when importing multi-task JSON"}
                                </span>
                            </label>
                        </div>
                        <footer className="p-5 border-t border-white/5 flex gap-3">
                            <button
                                className="btn-secondary flex-1"
                                onClick={closePasteTaskDialog}
                                disabled={importingPastedConfig || loading}
                            >
                                {t("cancel")}
                            </button>
                            <button
                                className="btn-gradient flex-1"
                                onClick={handlePasteDialogImport}
                                disabled={importingPastedConfig || loading}
                            >
                                {importingPastedConfig ? <Spinner className="animate-spin" /> : importTaskAction}
                            </button>
                        </footer>
                    </div>
                </div>
            )}

            {historyTaskName && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 bg-black/60 backdrop-blur-sm animate-fade-in">
                    <div className="glass-panel w-full max-w-4xl h-[78vh] flex flex-col shadow-2xl border border-white/10 overflow-hidden animate-zoom-in">
                        <div className="p-4 border-b border-white/5 flex justify-between items-center bg-white/2">
                            <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-lg bg-[#8a3ffc]/20 flex items-center justify-center text-[#b57dff]">
                                    <ListDashes weight="bold" size={18} />
                                </div>
                                <div className="space-y-2">
                                    <h3 className="font-bold tracking-tight">
                                        {t("task_history_logs_title").replace("{name}", historyTaskName)}
                                    </h3>
                                    <div className="flex items-center gap-2">
                                        <button
                                            type="button"
                                            onClick={() => setHistoryTab("messages")}
                                            className={`px-3 py-1.5 rounded-full border text-xs font-bold transition-all ${historyTab === "messages" ? "border-transparent bg-[#8a3ffc] text-white" : "history-tab-inactive"}`}
                                        >
                                            {t("task_monitor_messages_tab")}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setHistoryTab("logs")}
                                            className={`px-3 py-1.5 rounded-full border text-xs font-bold transition-all ${historyTab === "logs" ? "border-transparent bg-[#8a3ffc] text-white" : "history-tab-inactive"}`}
                                        >
                                            {t("logs")}
                                        </button>
                                    </div>
                                </div>
                            </div>
                            <button
                                onClick={() => setHistoryTaskName(null)}
                                className="action-btn !w-8 !h-8 hover:bg-white/10"
                            >
                                <X weight="bold" />
                            </button>
                        </div>
                        <div className="flex-1 overflow-y-auto p-4 font-mono text-[11px] leading-relaxed history-modal-body">
                            {historyLoading ? (
                                <div className="flex items-center gap-2 ui-muted italic">
                                    <Spinner className="animate-spin" size={12} />
                                    {t("loading")}
                                </div>
                            ) : historyLogs.length === 0 ? (
                                <div className="ui-muted italic">{t("task_history_empty")}</div>
                            ) : (
                                <div className="space-y-4">
                                    {historyLogs.map((log, i) => (
                                        <details key={`${log.time}-${i}`} className="rounded-xl border history-entry-card overflow-hidden" open={i === 0}>
                                            <summary className="flex flex-wrap justify-between items-center gap-3 px-4 py-3 cursor-pointer list-none">
                                                <div className="min-w-0">
                                                    <div className="text-xs text-main/70 font-medium">
                                                        {new Date(log.time).toLocaleString(language === "zh" ? "zh-CN" : "en-US")}
                                                    </div>
                                                    <div className="text-sm font-semibold text-main/90 break-all mt-1">
                                                        {log.message
                                                            ? (isZh ? `${t("task_monitor_summary")}：${log.message}` : `${t("task_monitor_summary")}: ${log.message}`)
                                                        : (isZh
                                                            ? `任务：${historyTaskName}${log.success ? "执行成功" : "执行失败"}`
                                                            : `Task: ${historyTaskName} ${log.success ? "succeeded" : "failed"}`)}
                                                    </div>
                                                </div>
                                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${log.success ? "status-badge-success" : "status-badge-danger"}`}>
                                                    {log.success ? t("success") : t("failure")}
                                                </span>
                                            </summary>
                                            <div className="px-4 pb-4 border-t border-white/5">
                                                <div className="pt-4 space-y-3">
                                                    <div className="text-sm font-semibold text-main/90">
                                                        {isZh
                                                            ? `任务：${historyTaskName}${log.success ? "执行成功" : "执行失败"}`
                                                            : `Task: ${historyTaskName} ${log.success ? "succeeded" : "failed"}`}
                                                    </div>
                                                    {historyTab === "messages" ? (
                                                        <div className="space-y-3">
                                                            <div className="text-[10px] uppercase tracking-wider ui-muted">
                                                                {t("task_monitor_messages_tab")}
                                                            </div>
                                                            {log.message_events && log.message_events.length > 0 ? (
                                                                <div className="space-y-3">
                                                                    {log.message_events.map((event, eventIndex) => {
                                                                        const message = describeMessageEvent(event);
                                                                        return (
                                                                            <div
                                                                                key={event.event_id || `${log.time}-${eventIndex}`}
                                                                                className="rounded-xl border history-message-card p-3"
                                                                            >
                                                                                <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] mb-2">
                                                                                    <span className="px-2 py-0.5 rounded-full bg-[#8a3ffc]/15 text-[#c59bff] border border-[#8a3ffc]/20">
                                                                                        {message.typeLabel}
                                                                                    </span>
                                                                                    <span className="text-main/70">
                                                                                        {event.event_time ? new Date(event.event_time).toLocaleString(language === "zh" ? "zh-CN" : "en-US") : t("no_data")}
                                                                                    </span>
                                                                                </div>
                                                                                <div className="ui-dim mb-2">
                                                                                    {message.senderName} → {message.recipientName}
                                                                                </div>
                                                                                <div className="text-main/85 break-words whitespace-pre-wrap">
                                                                                    {message.body}
                                                                                </div>
                                                                            </div>
                                                                        );
                                                                    })}
                                                                </div>
                                                            ) : (
                                                                <div className="ui-muted italic">{t("task_history_no_messages")}</div>
                                                            )}
                                                        </div>
                                                    ) : (
                                                        <div className="space-y-3">
                                                            <div className="text-[10px] uppercase tracking-wider ui-muted">
                                                                {t("logs")}
                                                            </div>
                                                            {log.flow_logs && log.flow_logs.length > 0 ? (
                                                                <div className="space-y-1">
                                                                    {log.flow_logs.map((line, lineIndex) => (
                                                                        <div key={lineIndex} className="text-main/80 flex gap-2 min-w-0">
                                                                            <span className="ui-line-number select-none w-6 shrink-0 text-right">
                                                                                {(lineIndex + 1).toString().padStart(2, "0")}
                                                                            </span>
                                                                            <span className="min-w-0 flex-1">
                                                                                <SignTaskFlowLogLine line={line} t={t} />
                                                                            </span>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            ) : (
                                                                <div className="ui-dim">
                                                                    {log.message || t("task_history_no_flow")}
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}
                                                    {log.flow_truncated && historyTab === "logs" && (
                                                        <div className="text-[10px] text-amber-400/90 mt-2">
                                                            {t("task_history_truncated").replace("{count}", String(log.flow_line_count || 0))}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </details>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            <ToastContainer toasts={toasts} removeToast={removeToast} />
        </div >
    );
}
