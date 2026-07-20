export type SortKey = "account" | "schedule" | "last_run";
export type SortDir = "asc" | "desc";

export type SortableSignTask = {
  name: string;
  account_name: string;
  sign_at: string;
  execution_mode?: "fixed" | "range";
  range_start?: string;
  last_run?: { time: string } | null;
};

export function scheduleKey(task: SortableSignTask): string {
  if (task.execution_mode === "range" && task.range_start) {
    return task.range_start;
  }
  return task.sign_at || "";
}

export function nextSortState(
  currentKey: SortKey,
  currentDir: SortDir,
  clickedKey: SortKey
): { sortKey: SortKey; sortDir: SortDir } {
  if (clickedKey !== currentKey) {
    return { sortKey: clickedKey, sortDir: "asc" };
  }
  return {
    sortKey: currentKey,
    sortDir: currentDir === "asc" ? "desc" : "asc",
  };
}

function primaryValue(task: SortableSignTask, key: SortKey): string {
  if (key === "account") return task.account_name || "";
  if (key === "schedule") return scheduleKey(task);
  return task.last_run?.time || "";
}

function compareStrings(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });
}

function tieBreak(a: SortableSignTask, b: SortableSignTask, key: SortKey): number {
  if (key !== "account") {
    const byAccount = compareStrings(a.account_name || "", b.account_name || "");
    if (byAccount !== 0) return byAccount;
  }
  return compareStrings(a.name || "", b.name || "");
}

function compareTasks(
  a: SortableSignTask,
  b: SortableSignTask,
  key: SortKey,
  dir: SortDir
): number {
  const av = primaryValue(a, key);
  const bv = primaryValue(b, key);
  const aEmpty = !av;
  const bEmpty = !bv;
  if (aEmpty && bEmpty) return tieBreak(a, b, key);
  if (aEmpty) return 1;
  if (bEmpty) return -1;
  const cmp = compareStrings(av, bv);
  const ordered = dir === "asc" ? cmp : -cmp;
  return ordered !== 0 ? ordered : tieBreak(a, b, key);
}

export function sortSignTasks<T extends SortableSignTask>(
  tasks: T[],
  key: SortKey,
  dir: SortDir
): T[] {
  return [...tasks].sort((a, b) => compareTasks(a, b, key, dir));
}
