export type TaskFormFrom = "sign-tasks" | "account-tasks";

export function parseTaskFormFrom(
  raw: string | null | undefined
): TaskFormFrom | null {
  if (raw === "sign-tasks" || raw === "account-tasks") return raw;
  return null;
}

export function resolveTaskFormReturnPath(
  from: TaskFormFrom | null | undefined,
  account?: string | null
): string {
  if (from === "account-tasks") {
    const name = (account || "").trim();
    if (name) {
      return `/dashboard/account-tasks?name=${encodeURIComponent(name)}`;
    }
  }
  return "/dashboard/sign-tasks";
}

export function buildCreateTaskPath(opts: {
  account?: string | null;
  from?: TaskFormFrom | null;
}): string {
  const params = new URLSearchParams();
  const account = (opts.account || "").trim();
  if (account) params.set("account", account);
  if (opts.from === "sign-tasks" || opts.from === "account-tasks") {
    params.set("from", opts.from);
  }
  const q = params.toString();
  return q
    ? `/dashboard/sign-tasks/create?${q}`
    : "/dashboard/sign-tasks/create";
}

export function buildEditTaskPath(opts: {
  account: string;
  name: string;
  from?: TaskFormFrom | null;
}): string {
  const params = new URLSearchParams();
  params.set("account", opts.account);
  params.set("name", opts.name);
  if (opts.from === "sign-tasks" || opts.from === "account-tasks") {
    params.set("from", opts.from);
  }
  return `/dashboard/sign-tasks/edit?${params.toString()}`;
}
