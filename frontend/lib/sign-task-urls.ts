// 任务 REST 路径构造：任务名/账号名会进入 URL 路径与查询串，必须编码。
// 含 # % 等字符的名称若未编码，会被浏览器当作片段分隔符/非法转义截断，
// 导致编辑/运行/删除/历史接口 404"任务不存在"（调度器不走 URL，任务仍会执行）。

export function encodePathSegment(segment: string | number): string {
    return encodeURIComponent(String(segment ?? ""));
}

export type SignTaskUrlOptions = {
    suffix?: string;
    params?: Record<string, string | undefined | null>;
};

export function buildSignTaskUrl(name: string, options: SignTaskUrlOptions = {}): string {
    let url = `/sign-tasks/${encodePathSegment(name)}`;
    if (options.suffix) {
        url += `/${encodePathSegment(options.suffix)}`;
    }
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(options.params ?? {})) {
        if (value === undefined || value === null) continue;
        params.set(key, value);
    }
    const query = params.toString();
    return query ? `${url}?${query}` : url;
}
