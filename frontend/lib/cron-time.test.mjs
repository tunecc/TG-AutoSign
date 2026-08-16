import assert from "node:assert/strict";

// 纯函数契约：与 create/edit 页内联 cronToFixedTime 行为一致。
// 该 JS 副本与 create 页 TS 实现保持同步（仅类型注解差异）。
function cronToFixedTime(cron) {
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

// 标准 5 段 cron "0 M H * * *" → "HH:MM"
assert.equal(cronToFixedTime("0 30 9 * * *"), "09:30");
assert.equal(cronToFixedTime("0 0 6 * * *"), "06:00");
assert.equal(cronToFixedTime("0 59 23 * * *"), "23:59");
assert.equal(cronToFixedTime("0 5 0 * * *"), "00:05");

// 补零：单位数小时/分钟
assert.equal(cronToFixedTime("0 5 9 * * *"), "09:05");
assert.equal(cronToFixedTime("0 30 0 * * *"), "00:30");

// 空值 / 不完整 → 默认 06:00
assert.equal(cronToFixedTime(""), "06:00");
assert.equal(cronToFixedTime("0"), "06:00");
assert.equal(cronToFixedTime("0 30"), "06:00");

// 非数字分钟/小时 → 默认 06:00
assert.equal(cronToFixedTime("0 abc 9 * * *"), "06:00");
assert.equal(cronToFixedTime("0 30 xyz * * *"), "06:00");

// 空白容错
assert.equal(cronToFixedTime("   0   30   9   *   *   *   "), "09:30");

console.log("cron-time: all assertions passed");
