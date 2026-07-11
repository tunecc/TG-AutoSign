export type IntervalMode = "fixed" | "random";

export type IntervalFields = {
  action_interval?: number;
  action_interval_mode?: IntervalMode;
  action_interval_ms?: number;
  action_interval_min_ms?: number;
  action_interval_max_ms?: number;
};

export function hmsToMs(h: number, m: number, s: number): number {
  const hh = Math.max(0, Math.floor(Number(h) || 0));
  const mm = Math.max(0, Math.floor(Number(m) || 0));
  const ss = Math.max(0, Math.floor(Number(s) || 0));
  return ((hh * 60 + mm) * 60 + ss) * 1000;
}

export function msToHms(ms: number): { h: number; m: number; s: number } {
  const total = Math.max(0, Math.floor(Number(ms) || 0));
  const s = Math.floor(total / 1000) % 60;
  const m = Math.floor(total / 60000) % 60;
  const h = Math.floor(total / 3600000);
  return { h, m, s };
}

export function formatDuration(ms: number): string {
  const { h, m, s } = msToHms(ms);
  if (h === 0 && m === 0 && s === 0) return "0s";
  const parts: string[] = [];
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if (s || parts.length === 0) parts.push(`${s}s`);
  return parts.join("");
}

export function normalizeChatInterval<T extends IntervalFields>(chat: T): T & {
  action_interval_mode: IntervalMode;
  action_interval_ms: number;
  action_interval_min_ms: number;
  action_interval_max_ms: number;
  action_interval: number;
} {
  const mode: IntervalMode = chat.action_interval_mode === "random" ? "random" : "fixed";
  const legacy = Number(chat.action_interval);
  const legacyMs = Number.isFinite(legacy) && legacy >= 0 ? legacy : 1000;

  if (mode === "random") {
    let min = Number(chat.action_interval_min_ms);
    let max = Number(chat.action_interval_max_ms);
    if (!Number.isFinite(min) || min < 0) min = Number(chat.action_interval_ms);
    if (!Number.isFinite(min) || min < 0) min = legacyMs;
    if (!Number.isFinite(max) || max < 0) max = min;
    if (min > max) {
      const t = min;
      min = max;
      max = t;
    }
    return {
      ...chat,
      action_interval_mode: "random",
      action_interval_ms: min,
      action_interval_min_ms: min,
      action_interval_max_ms: max,
      action_interval: min,
    };
  }

  let ms = Number(chat.action_interval_ms);
  if (!Number.isFinite(ms) || ms < 0) ms = legacyMs;
  return {
    ...chat,
    action_interval_mode: "fixed",
    action_interval_ms: ms,
    action_interval_min_ms: ms,
    action_interval_max_ms: ms,
    action_interval: ms,
  };
}

export function formatChatIntervalSummary(chat: IntervalFields): string {
  const n = normalizeChatInterval(chat);
  if (n.action_interval_mode === "random") {
    return `${formatDuration(n.action_interval_min_ms)} ~ ${formatDuration(n.action_interval_max_ms)}`;
  }
  return formatDuration(n.action_interval_ms);
}

export function validateIntervalFields(chat: IntervalFields): string | null {
  const n = normalizeChatInterval(chat);
  if (n.action_interval_mode === "random" && n.action_interval_min_ms > n.action_interval_max_ms) {
    return "interval_min_gt_max";
  }
  return null;
}
