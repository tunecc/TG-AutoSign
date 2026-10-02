import assert from "node:assert/strict";

// 纯函数契约：sign-task REST 路径必须对任务名做 encodeURIComponent，
// 否则含 #/% 等字符的任务名会被浏览器截断为片段/非法转义，导致 404"任务不存在"。
import {
    encodePathSegment,
    buildSignTaskUrl,
} from "./sign-task-urls.ts";

// encodePathSegment
assert.equal(encodePathSegment("qd"), "qd");
assert.ok(encodePathSegment("签到#1").includes("%23"));
assert.ok(!encodePathSegment("签到#1").includes("#"));
assert.ok(encodePathSegment("100%").includes("%25"));
assert.ok(encodePathSegment("100%").endsWith("%25"));
assert.ok(encodePathSegment("ig t").includes("%20"));

// buildSignTaskUrl：普通名称保持原样
assert.equal(buildSignTaskUrl("qd"), "/sign-tasks/qd");
assert.equal(
    buildSignTaskUrl("qd", { suffix: "run", params: { account_name: "ig t" } }),
    "/sign-tasks/qd/run?account_name=ig+t"
);
assert.equal(
    buildSignTaskUrl("qd", { params: { account_name: "ig t", limit: "20" } }),
    "/sign-tasks/qd?account_name=ig+t&limit=20"
);

// buildSignTaskUrl：特殊字符名称被完整编码
const encoded = encodeURIComponent("签到#1");
assert.equal(
    buildSignTaskUrl("签到#1", { params: { account_name: "ig t" } }),
    `/sign-tasks/${encoded}?account_name=ig+t`
);
assert.equal(
    buildSignTaskUrl("100%", { suffix: "history", params: { account_name: "a" } }),
    `/sign-tasks/${encodeURIComponent("100%")}/history?account_name=a`
);

// 空参数省略与空字符串保留
assert.equal(buildSignTaskUrl("qd", {}), "/sign-tasks/qd");
assert.equal(
    buildSignTaskUrl("qd", { params: { account_name: "" } }),
    "/sign-tasks/qd?account_name="
);
assert.equal(
    buildSignTaskUrl("qd", { params: { account_name: undefined } }),
    "/sign-tasks/qd"
);

console.log("sign-task-urls tests passed");
