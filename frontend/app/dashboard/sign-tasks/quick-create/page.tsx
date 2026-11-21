"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { getToken } from "../../../../lib/auth";
import {
    listAccounts,
    quickCreateSignTasks,
    AccountInfo,
    QuickCreateFailedItem,
    SignTask,
} from "../../../../lib/api";
import {
    CaretLeft,
    Lightning,
    Trash,
    Spinner,
    CheckCircle,
    WarningCircle,
} from "@phosphor-icons/react";

import { ThemeLanguageToggle } from "../../../../components/ThemeLanguageToggle";
import { useLanguage } from "../../../../context/LanguageContext";
import { ToastContainer, useToast } from "../../../../components/ui/toast";

type BotDraft = {
    name: string;
    chat_id: string;
    commands: string;
};

// 预填用户当前使用的三个机器人及其命令
const DEFAULT_BOTS: BotDraft[] = [
    { name: "蓝色", chat_id: "7460869927", commands: "/qd\n/hz 15070527892 5" },
    { name: "金鼎", chat_id: "5969411283", commands: "/qd\n/hz 15070527892 5" },
    { name: "绿色", chat_id: "6379863842", commands: "/qd\n/hz 15070527892 5" },
];

const FREQUENCY_OPTIONS = [1, 2, 3, 4, 6, 8, 12, 24];

type QuickCreateResult = {
    created: SignTask[];
    failed: QuickCreateFailedItem[];
};

export default function QuickCreateTaskPage() {
    const router = useRouter();
    const { language } = useLanguage();
    const { toasts, addToast, removeToast } = useToast();
    const zh = language === "zh";

    const [token, setToken] = useState<string | null>(null);
    const [accounts, setAccounts] = useState<AccountInfo[]>([]);
    const [selectedAccounts, setSelectedAccounts] = useState<Set<string>>(new Set());
    const [bots, setBots] = useState<BotDraft[]>(DEFAULT_BOTS);
    const [frequencyHours, setFrequencyHours] = useState(1);
    const [randomDelaySeconds, setRandomDelaySeconds] = useState(3600);
    const [intervalMinSeconds, setIntervalMinSeconds] = useState(60);
    const [intervalMaxSeconds, setIntervalMaxSeconds] = useState(600);
    const [loading, setLoading] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [result, setResult] = useState<QuickCreateResult | null>(null);

    useEffect(() => {
        const t = getToken();
        if (!t) {
            router.push("/login");
            return;
        }
        setToken(t);
    }, [router]);

    const loadAccounts = useCallback(async (t: string) => {
        try {
            setLoading(true);
            const res = await listAccounts(t);
            setAccounts(res.accounts);
            // 默认全选
            setSelectedAccounts(new Set(res.accounts.map((a) => a.name)));
        } catch (err: any) {
            addToast(zh ? "加载账号失败" : "Failed to load accounts", "error");
        } finally {
            setLoading(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [zh]);

    useEffect(() => {
        if (token) loadAccounts(token);
    }, [token, loadAccounts]);

    const toggleAccount = (name: string) => {
        setSelectedAccounts((prev) => {
            const next = new Set(prev);
            if (next.has(name)) {
                next.delete(name);
            } else {
                next.add(name);
            }
            return next;
        });
    };

    const toggleAllAccounts = () => {
        setSelectedAccounts((prev) => {
            if (prev.size === accounts.length) {
                return new Set();
            }
            return new Set(accounts.map((a) => a.name));
        });
    };

    const updateBot = (index: number, patch: Partial<BotDraft>) => {
        setBots((prev) => prev.map((bot, i) => (i === index ? { ...bot, ...patch } : bot)));
    };

    const removeBot = (index: number) => {
        setBots((prev) => prev.filter((_, i) => i !== index));
    };

    const addBot = () => {
        setBots((prev) => [...prev, { name: "", chat_id: "", commands: "/qd" }]);
    };

    const buildPayload = () => {
        const errors: string[] = [];
        const accountList = Array.from(selectedAccounts);
        if (accountList.length === 0) {
            errors.push(zh ? "请至少选择一个账号" : "Select at least one account");
        }

        const parsedBots: { name: string; chat_id: number; commands: string[] }[] = [];
        bots.forEach((bot, i) => {
            const chatId = Number(String(bot.chat_id).trim());
            if (!Number.isFinite(chatId) || chatId === 0) {
                errors.push(
                    zh
                        ? `机器人 #${i + 1} 的 Chat ID 无效`
                        : `Invalid Chat ID for bot #${i + 1}`
                );
                return;
            }
            const commands = bot.commands
                .split("\n")
                .map((c) => c.trim())
                .filter(Boolean);
            if (commands.length === 0) {
                errors.push(
                    zh
                        ? `机器人 #${i + 1} 未配置命令`
                        : `No commands configured for bot #${i + 1}`
                );
                return;
            }
            parsedBots.push({
                name: bot.name.trim(),
                chat_id: chatId,
                commands,
            });
        });
        if (parsedBots.length === 0) {
            errors.push(zh ? "请至少配置一个机器人" : "Configure at least one bot");
        }

        const minS = Number(intervalMinSeconds);
        const maxS = Number(intervalMaxSeconds);
        if (!Number.isFinite(minS) || minS <= 0) {
            errors.push(zh ? "动作间隔下限必须大于 0" : "Min interval must be > 0");
        }
        if (!Number.isFinite(maxS) || maxS < minS) {
            errors.push(zh ? "动作间隔上限不能小于下限" : "Max interval must be >= min");
        }
        const delayS = Number(randomDelaySeconds);
        if (!Number.isFinite(delayS) || delayS <= 0) {
            errors.push(zh ? "随机延迟必须大于 0" : "Random delay must be > 0");
        }

        if (errors.length > 0) {
            addToast(errors[0], "error");
            return null;
        }

        return {
            accounts: accountList,
            bots: parsedBots,
            frequency_hours: frequencyHours,
            random_delay_seconds: delayS,
            interval_min_seconds: minS,
            interval_max_seconds: maxS,
        };
    };

    const handleSubmit = async () => {
        if (!token) return;
        const payload = buildPayload();
        if (!payload) return;
        try {
            setSubmitting(true);
            const res = await quickCreateSignTasks(token, payload);
            setResult(res);
            const failedCount = res.failed.length;
            if (failedCount > 0) {
                addToast(
                    zh
                        ? `已创建 ${res.created.length} 个任务，${failedCount} 个账号失败`
                        : `Created ${res.created.length} tasks, ${failedCount} account(s) failed`,
                    "error"
                );
            } else {
                addToast(
                    zh
                        ? `已为 ${res.created.length} 个账号创建任务`
                        : `Created tasks for ${res.created.length} account(s)`,
                    "success"
                );
            }
        } catch (err: any) {
            const detail = err?.message || (zh ? "快速创建失败" : "Quick create failed");
            addToast(detail, "error");
        } finally {
            setSubmitting(false);
        }
    };

    if (!token) return null;

    const frequencyLabel = (hours: number) =>
        hours === 1 ? (zh ? "每小时" : "Hourly") : zh ? `每 ${hours} 小时` : `Every ${hours}h`;

    return (
        <div id="quick-create-task-view" className="w-full h-full flex flex-col pt-[72px]">
            <nav className="navbar fixed top-0 left-0 right-0 z-50 h-[72px] px-5 md:px-10 flex justify-between items-center glass-panel rounded-none border-x-0 border-t-0 bg-white/2 dark:bg-black/5">
                <div className="flex items-center gap-4">
                    <button
                        onClick={() => router.push("/dashboard/sign-tasks")}
                        className="action-btn"
                        title={zh ? "返回" : "Back"}
                    >
                        <CaretLeft weight="bold" />
                    </button>
                    <div className="flex items-center gap-2 text-sm font-medium">
                        <span className="text-main/40 uppercase tracking-widest text-[10px]">
                            {zh ? "任务中心" : "Tasks"}
                        </span>
                        <span className="text-main/20">/</span>
                        <span className="text-main uppercase tracking-widest text-[10px]">
                            {zh ? "快速创建" : "Quick Create"}
                        </span>
                    </div>
                </div>
                <div className="flex items-center gap-4">
                    <ThemeLanguageToggle />
                </div>
            </nav>

            <main className="flex-1 p-5 md:p-10 w-full max-w-[900px] mx-auto overflow-y-auto animate-float-up pb-20">
                <header className="mb-10">
                    <h1 className="text-3xl font-bold tracking-tight mb-2">
                        {zh ? "快速创建签到任务" : "Quick Create Sign Tasks"}
                    </h1>
                    <p className="text-[#9496a1] text-sm">
                        {zh
                            ? "为所有选中账号创建每小时签到任务：对每个机器人依次发送命令，命令之间随机等待。"
                            : "Create hourly sign tasks for all selected accounts: send commands to each bot in order with random waits between them."}
                    </p>
                </header>

                <div className="grid gap-8">
                    {/* 账号选择 */}
                    <section className="glass-panel p-6 space-y-4">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-[#8a3ffc]/10 rounded-lg text-[#b57dff]">
                                    <Lightning weight="fill" size={18} />
                                </div>
                                <h2 className="text-lg font-bold">
                                    {zh ? "执行账号" : "Accounts"}
                                </h2>
                            </div>
                            <button
                                onClick={toggleAllAccounts}
                                className="text-xs text-[#8a3ffc] hover:underline"
                                disabled={loading}
                            >
                                {selectedAccounts.size === accounts.length && accounts.length > 0
                                    ? zh
                                        ? "取消全选"
                                        : "Deselect all"
                                    : zh
                                        ? "全选"
                                        : "Select all"}
                            </button>
                        </div>
                        {loading ? (
                            <div className="py-8 flex justify-center text-main/20">
                                <Spinner size={28} weight="bold" className="animate-spin" />
                            </div>
                        ) : accounts.length === 0 ? (
                            <p className="text-sm text-[#9496a1] py-4">
                                {zh ? "暂无可用账号，请先添加账号" : "No accounts available. Add an account first."}
                            </p>
                        ) : (
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                                {accounts.map((acc) => (
                                    <button
                                        key={acc.name}
                                        onClick={() => toggleAccount(acc.name)}
                                        className={`p-3 rounded-xl border text-left transition-all ${
                                            selectedAccounts.has(acc.name)
                                                ? "border-[#8a3ffc]/50 bg-[#8a3ffc]/10"
                                                : "border-white/10 bg-white/2 hover:border-[#8a3ffc]/30"
                                        }`}
                                    >
                                        <div className="text-sm font-bold">{acc.name}</div>
                                        <div className="text-[10px] text-main/30 mt-1 uppercase tracking-wider">
                                            {zh ? "账号" : "Account"}
                                        </div>
                                    </button>
                                ))}
                            </div>
                        )}
                    </section>

                    {/* 机器人清单 */}
                    <section className="glass-panel p-6 space-y-4">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-[#8a3ffc]/10 rounded-lg text-[#b57dff]">
                                    <Lightning weight="fill" size={18} />
                                </div>
                                <h2 className="text-lg font-bold">{zh ? "机器人清单" : "Bots"}</h2>
                            </div>
                            <button onClick={addBot} className="text-xs text-[#8a3ffc] hover:underline">
                                {zh ? "+ 添加机器人" : "+ Add bot"}
                            </button>
                        </div>
                        <p className="text-[10px] text-main/30">
                            {zh
                                ? "每个机器人一个配置行；命令按行填写、按顺序发送，命令之间随机等待。"
                                : "One row per bot; commands are sent in order with a random wait between them."}
                        </p>
                        <div className="space-y-4">
                            {bots.map((bot, i) => (
                                <div key={i} className="p-4 glass-panel !bg-black/5 space-y-3 border-white/5">
                                    <div className="flex items-center justify-between">
                                        <span className="text-xs font-bold text-main/40 uppercase tracking-wider">
                                            {zh ? "机器人" : "Bot"} #{i + 1}
                                        </span>
                                        {bots.length > 1 && (
                                            <button
                                                onClick={() => removeBot(i)}
                                                className="action-btn !w-7 !h-7 text-red-400"
                                                title={zh ? "删除" : "Remove"}
                                            >
                                                <Trash weight="bold" size={14} />
                                            </button>
                                        )}
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                            <label className="text-xs font-bold text-main/40 uppercase tracking-wider">
                                                {zh ? "别名" : "Alias"}
                                            </label>
                                            <input
                                                className="!mb-0"
                                                value={bot.name}
                                                onChange={(e) => updateBot(i, { name: e.target.value })}
                                                placeholder={zh ? "如 蓝色" : "e.g. Blue"}
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-xs font-bold text-main/40 uppercase tracking-wider">
                                                Chat ID
                                            </label>
                                            <input
                                                className="!mb-0"
                                                value={bot.chat_id}
                                                onChange={(e) => updateBot(i, { chat_id: e.target.value })}
                                                placeholder="7460869927"
                                            />
                                        </div>
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-xs font-bold text-main/40 uppercase tracking-wider">
                                            {zh ? "命令（每行一条，按顺序发送）" : "Commands (one per line, sent in order)"}
                                        </label>
                                        <textarea
                                            className="!mb-0 font-mono text-sm"
                                            rows={3}
                                            value={bot.commands}
                                            onChange={(e) => updateBot(i, { commands: e.target.value })}
                                            placeholder={"/qd\n/hz 15070527892 5"}
                                        />
                                    </div>
                                </div>
                            ))}
                        </div>
                    </section>

                    {/* 执行设置 */}
                    <section className="glass-panel p-6 space-y-6">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-[#8a3ffc]/10 rounded-lg text-[#b57dff]">
                                <Lightning weight="fill" size={18} />
                            </div>
                            <h2 className="text-lg font-bold">{zh ? "执行设置" : "Schedule"}</h2>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="space-y-2">
                                <label className="text-xs font-bold text-main/40 uppercase tracking-wider">
                                    {zh ? "执行频率" : "Frequency"}
                                </label>
                                <select
                                    className="!mb-0"
                                    value={frequencyHours}
                                    onChange={(e) => setFrequencyHours(Number(e.target.value))}
                                >
                                    {FREQUENCY_OPTIONS.map((h) => (
                                        <option key={h} value={h}>
                                            {frequencyLabel(h)}
                                        </option>
                                    ))}
                                </select>
                                <p className="text-[10px] text-main/30">
                                    {zh
                                        ? "每小时触发一次，在小时内随机时刻执行，全天覆盖。"
                                        : "Triggers hourly and runs at a random moment within the hour, covering the whole day."}
                                </p>
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs font-bold text-main/40 uppercase tracking-wider">
                                    {zh ? "小时内随机延迟上限（秒）" : "Max random delay (seconds)"}
                                </label>
                                <input
                                    className="!mb-0"
                                    type="number"
                                    min={1}
                                    value={randomDelaySeconds}
                                    onChange={(e) => setRandomDelaySeconds(Number(e.target.value))}
                                />
                                <p className="text-[10px] text-main/30">
                                    {zh
                                        ? "实际延迟不超过执行频率间隔。"
                                        : "Clamped to the frequency interval."}
                                </p>
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs font-bold text-main/40 uppercase tracking-wider">
                                    {zh ? "命令间隔下限（秒）" : "Min interval (seconds)"}
                                </label>
                                <input
                                    className="!mb-0"
                                    type="number"
                                    min={1}
                                    value={intervalMinSeconds}
                                    onChange={(e) => setIntervalMinSeconds(Number(e.target.value))}
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs font-bold text-main/40 uppercase tracking-wider">
                                    {zh ? "命令间隔上限（秒）" : "Max interval (seconds)"}
                                </label>
                                <input
                                    className="!mb-0"
                                    type="number"
                                    min={1}
                                    value={intervalMaxSeconds}
                                    onChange={(e) => setIntervalMaxSeconds(Number(e.target.value))}
                                />
                                <p className="text-[10px] text-main/30">
                                    {zh
                                        ? "同一机器人内两条命令之间的随机等待范围。"
                                        : "Random wait range between two commands of the same bot."}
                                </p>
                            </div>
                        </div>
                    </section>

                    {/* 提交 */}
                    <button
                        onClick={handleSubmit}
                        disabled={submitting || loading || accounts.length === 0}
                        className="w-full py-4 rounded-2xl bg-[#8a3ffc] text-white font-bold text-sm hover:bg-[#7a2ff0] transition-all disabled:opacity-40 flex items-center justify-center gap-2"
                    >
                        {submitting ? (
                            <>
                                <Spinner size={18} weight="bold" className="animate-spin" />
                                {zh ? "创建中..." : "Creating..."}
                            </>
                        ) : (
                            <>
                                <Lightning weight="fill" size={18} />
                                {zh
                                    ? `为 ${selectedAccounts.size} 个账号创建任务`
                                    : `Create tasks for ${selectedAccounts.size} account(s)`}
                            </>
                        )}
                    </button>

                    {/* 创建结果 */}
                    {result && (
                        <section className="glass-panel p-6 space-y-4">
                            <h2 className="text-lg font-bold">{zh ? "创建结果" : "Result"}</h2>
                            {result.created.length > 0 && (
                                <div className="space-y-2">
                                    {result.created.map((task) => (
                                        <div
                                            key={`${task.account_name}-${task.name}`}
                                            className="flex items-center gap-3 p-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5"
                                        >
                                            <CheckCircle weight="fill" size={18} className="text-emerald-500 shrink-0" />
                                            <div className="text-sm">
                                                <span className="font-bold">{task.account_name}</span>
                                                <span className="text-main/40 mx-2">→</span>
                                                <span>{task.name}</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                            {result.failed.length > 0 && (
                                <div className="space-y-2">
                                    {result.failed.map((item) => (
                                        <div
                                            key={`${item.account_name}-${item.task_name}`}
                                            className="flex items-start gap-3 p-3 rounded-xl border border-red-500/30 bg-red-500/5"
                                        >
                                            <WarningCircle weight="fill" size={18} className="text-red-500 shrink-0 mt-0.5" />
                                            <div className="text-sm">
                                                <span className="font-bold">{item.account_name}</span>
                                                <div className="text-red-400/80 text-xs mt-1">{item.error}</div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </section>
                    )}
                </div>
            </main>

            <ToastContainer toasts={toasts} removeToast={removeToast} />
        </div>
    );
}
