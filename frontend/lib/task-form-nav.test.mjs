import assert from "node:assert/strict";
import {
  parseTaskFormFrom,
  resolveTaskFormReturnPath,
  buildCreateTaskPath,
  buildEditTaskPath,
} from "./task-form-nav.ts";

assert.equal(parseTaskFormFrom("sign-tasks"), "sign-tasks");
assert.equal(parseTaskFormFrom("account-tasks"), "account-tasks");
assert.equal(parseTaskFormFrom("nope"), null);
assert.equal(parseTaskFormFrom(null), null);

assert.equal(resolveTaskFormReturnPath("sign-tasks"), "/dashboard/sign-tasks");
assert.equal(resolveTaskFormReturnPath(null), "/dashboard/sign-tasks");
assert.equal(
  resolveTaskFormReturnPath("account-tasks", "alice"),
  "/dashboard/account-tasks?name=alice"
);
assert.equal(
  resolveTaskFormReturnPath("account-tasks", ""),
  "/dashboard/sign-tasks"
);

assert.equal(
  buildCreateTaskPath({ from: "sign-tasks" }),
  "/dashboard/sign-tasks/create?from=sign-tasks"
);
assert.equal(
  buildCreateTaskPath({ account: "alice", from: "account-tasks" }),
  "/dashboard/sign-tasks/create?account=alice&from=account-tasks"
);
assert.equal(
  buildEditTaskPath({ account: "alice", name: "每日签到", from: "sign-tasks" }),
  "/dashboard/sign-tasks/edit?account=alice&name=%E6%AF%8F%E6%97%A5%E7%AD%BE%E5%88%B0&from=sign-tasks"
);

console.log("task-form-nav tests passed");
