import assert from "node:assert/strict";
import {
  scheduleKey,
  nextSortState,
  sortSignTasks,
} from "./task-list-sort.ts";

// --- scheduleKey ---
assert.equal(
  scheduleKey({ name: "a", account_name: "x", sign_at: "09:00" }),
  "09:00"
);
assert.equal(
  scheduleKey({
    name: "a",
    account_name: "x",
    sign_at: "09:00",
    execution_mode: "range",
    range_start: "08:30",
  }),
  "08:30"
);
assert.equal(
  scheduleKey({
    name: "a",
    account_name: "x",
    sign_at: "09:00",
    execution_mode: "range",
  }),
  "09:00"
);

// --- nextSortState ---
assert.deepEqual(nextSortState("account", "asc", "schedule"), {
  sortKey: "schedule",
  sortDir: "asc",
});
assert.deepEqual(nextSortState("schedule", "asc", "schedule"), {
  sortKey: "schedule",
  sortDir: "desc",
});
assert.deepEqual(nextSortState("schedule", "desc", "schedule"), {
  sortKey: "schedule",
  sortDir: "asc",
});
assert.deepEqual(nextSortState("last_run", "desc", "account"), {
  sortKey: "account",
  sortDir: "asc",
});

// --- fixtures ---
const tasks = [
  {
    name: "t2",
    account_name: "bob",
    sign_at: "10:00",
    last_run: { time: "2026-07-01T12:00:00Z" },
  },
  {
    name: "t1",
    account_name: "alice",
    sign_at: "08:00",
    last_run: { time: "2026-07-02T12:00:00Z" },
  },
  {
    name: "t3",
    account_name: "alice",
    sign_at: "09:00",
    execution_mode: "range",
    range_start: "07:00",
    last_run: null,
  },
  {
    name: "t0",
    account_name: "carol",
    sign_at: "11:00",
    // no last_run
  },
];

// default account asc: alice, alice, bob, carol; tie-break by name
{
  const sorted = sortSignTasks(tasks, "account", "asc").map(
    (t) => `${t.account_name}:${t.name}`
  );
  assert.deepEqual(sorted, ["alice:t1", "alice:t3", "bob:t2", "carol:t0"]);
}

// account desc — primary desc; tie-break name always asc (t1 before t3)
{
  const sorted = sortSignTasks(tasks, "account", "desc").map(
    (t) => `${t.account_name}:${t.name}`
  );
  assert.deepEqual(sorted, ["carol:t0", "bob:t2", "alice:t1", "alice:t3"]);
}

// schedule asc: range uses range_start 07:00, then 08:00, 10:00, 11:00
{
  const sorted = sortSignTasks(tasks, "schedule", "asc").map((t) => t.name);
  assert.deepEqual(sorted, ["t3", "t1", "t2", "t0"]);
}

// schedule desc
{
  const sorted = sortSignTasks(tasks, "schedule", "desc").map((t) => t.name);
  assert.deepEqual(sorted, ["t0", "t2", "t1", "t3"]);
}

// last_run asc: early first; missing last_run always at bottom (t3, t0)
{
  const sorted = sortSignTasks(tasks, "last_run", "asc").map((t) => t.name);
  assert.equal(sorted[0], "t2"); // 07-01
  assert.equal(sorted[1], "t1"); // 07-02
  // bottoms: t3 and t0, order by account then name
  assert.deepEqual(sorted.slice(2).sort(), ["t0", "t3"].sort());
  assert.ok(sorted.indexOf("t3") >= 2);
  assert.ok(sorted.indexOf("t0") >= 2);
}

// last_run desc: late first; missing still bottom
{
  const sorted = sortSignTasks(tasks, "last_run", "desc").map((t) => t.name);
  assert.equal(sorted[0], "t1");
  assert.equal(sorted[1], "t2");
  assert.ok(sorted.indexOf("t3") >= 2);
  assert.ok(sorted.indexOf("t0") >= 2);
}

// does not mutate input
{
  const copy = tasks.map((t) => ({ ...t }));
  sortSignTasks(tasks, "schedule", "desc");
  assert.deepEqual(
    tasks.map((t) => t.name),
    copy.map((t) => t.name)
  );
}

console.log("task-list-sort: all assertions passed");
