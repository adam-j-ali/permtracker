import "server-only";

import { spawn as spawnProcess, type ChildProcess } from "node:child_process";

/**
 * Reads straight from the database file, for a web copy on the same server as the database.
 *
 * Every read through sqld's HTTP interface opens a fresh SQLite connection: about 6 ms for `SELECT 1`, more under
 * load, and sqld served those requests close to one at a time (40 at once took 254 ms). A page build makes about
 * 40 reads, so on Nov 8 2026 that overhead was most of a 0.36 s employer build and two thirds of a CPU core. The
 * same reads on a connection kept open take 0.002 to 2 ms.
 *
 * Set DATABASE_LOCAL_PATH (and DATABASE_LCA_LOCAL_PATH for the LCA database) to the database file and reads go
 * here; unset (every build machine, local development), nothing changes. The file is opened read-only with
 * `query_only` on, so the page layer still can't write, as with the read-only HTTP token. Writes stay on sqld.
 *
 * The reads run in a small pool of child processes, because node:sqlite is synchronous and one slow scan on the main
 * thread would hold up every request the copy is serving. Processes, not worker threads: a thread can't be stopped
 * inside a native SQLite call, so a runaway read would spin a core for good, while a process can always be killed.
 * A read past its deadline kills its process and a fresh one takes its place. Any other failure here is the
 * caller's cue to read through sqld instead, so a problem with the file costs speed, never a page.
 */

export type LocalHome = "main" | "lca";

export function localPathFor(home: LocalHome): string | undefined {
  const v = home === "lca" ? process.env.DATABASE_LCA_LOCAL_PATH : process.env.DATABASE_LOCAL_PATH;
  return v || undefined;
}

export interface LocalResult {
  columns: string[];
  rows: unknown[][];
}

/** A read that ran past its deadline: not retried through sqld, which would wait as long again. */
export class LocalDeadlineError extends Error {}

// Plain CommonJS run with \`node -e\`, so no bundler has to find a second entry file.
const WORKER_SOURCE = `
const { DatabaseSync } = require("node:sqlite");
const open = new Map();
function conn(path) {
  let c = open.get(path);
  if (!c) {
    const db = new DatabaseSync(path, { readOnly: true });
    db.exec("PRAGMA query_only = 1");
    c = { db, stmts: new Map() };
    open.set(path, c);
  }
  return c;
}
process.on("disconnect", () => process.exit(0));
process.on("message", ({ id, path, sql, args }) => {
  try {
    const c = conn(path);
    let st = c.stmts.get(sql);
    if (!st) {
      st = c.db.prepare(sql);
      st.setReturnArrays(true);
      if (c.stmts.size >= 500) c.stmts.delete(c.stmts.keys().next().value);
      c.stmts.set(sql, st);
    }
    const rows = st.all(...args);
    process.send({ id, columns: st.columns().map((col) => col.name), rows });
  } catch (e) {
    process.send({ id, error: String((e && e.message) || e) });
  }
});
`;

interface Job {
  id: number;
  path: string;
  sql: string;
  args: unknown[];
  deadlineMs: number;
  resolve: (r: LocalResult) => void;
  reject: (e: Error) => void;
}

interface Slot {
  worker: ChildProcess;
  job: Job | null;
  timer: ReturnType<typeof setTimeout> | null;
}

const WORKERS = Math.max(1, Number(process.env.DATABASE_LOCAL_WORKERS) || 2);
const slots: Slot[] = [];
const queue: Job[] = [];
let nextId = 1;

function spawn(): Slot {
  const worker = spawnProcess(process.execPath, ["--no-warnings", "-e", WORKER_SOURCE], {
    stdio: ["ignore", "inherit", "inherit", "ipc"],
    serialization: "advanced",
  });
  worker.unref();
  worker.channel?.unref();
  const slot: Slot = { worker, job: null, timer: null };
  worker.on("message", (m: { id: number; columns?: string[]; rows?: unknown[][]; error?: string }) => {
    const job = slot.job;
    if (!job || job.id !== m.id) return;
    finish(slot);
    if (m.error !== undefined) job.reject(new Error(`local read failed: ${m.error}`));
    else job.resolve({ columns: m.columns ?? [], rows: m.rows ?? [] });
    pump();
  });
  // A worker that dies takes only its own read with it; the read goes through sqld and a new worker takes the slot.
  const lost = (why: string) => {
    const job = slot.job;
    finish(slot);
    replace(slot);
    job?.reject(new Error(`local read worker stopped: ${why}`));
    pump();
  };
  worker.on("error", (e) => lost(String(e)));
  worker.on("exit", (code, signal) => {
    if (slots.includes(slot)) lost(`exit ${code ?? signal}`);
  });
  return slot;
}

function finish(slot: Slot): void {
  if (slot.timer) clearTimeout(slot.timer);
  slot.timer = null;
  slot.job = null;
}

function replace(slot: Slot): void {
  const i = slots.indexOf(slot);
  if (i >= 0) slots[i] = spawn();
}

function pump(): void {
  for (const slot of slots) {
    if (slot.job || queue.length === 0) continue;
    const job = queue.shift() as Job;
    slot.job = job;
    slot.timer = setTimeout(() => {
      if (slot.job !== job) return;
      finish(slot);
      replace(slot);
      slot.worker.kill("SIGKILL");
      job.reject(new LocalDeadlineError(`database query deadline (${job.deadlineMs}ms, local read): ${job.sql.slice(0, 80)}`));
      pump();
    }, job.deadlineMs);
    slot.timer.unref?.();
    slot.worker.send({ id: job.id, path: job.path, sql: job.sql, args: job.args });
  }
}

/** libSQL's argument rules, so the same call means the same thing on either path. */
function bindable(v: unknown): unknown {
  if (typeof v === "boolean") return v ? 1 : 0;
  return v;
}

export function localRead(path: string, sql: string, args: unknown[], deadlineMs: number): Promise<LocalResult> {
  if (slots.length === 0) for (let i = 0; i < WORKERS; i++) slots.push(spawn());
  return new Promise<LocalResult>((resolve, reject) => {
    queue.push({ id: nextId++, path, sql, args: args.map(bindable), deadlineMs, resolve, reject });
    pump();
  });
}

/** Rows as objects the way libSQL builds them: the first of two same-named columns wins. */
export function objectsOf(r: LocalResult): Record<string, unknown>[] {
  return r.rows.map((values) => {
    const o: Record<string, unknown> = {};
    r.columns.forEach((c, i) => {
      if (Object.hasOwn(o, c)) return;
      const v = values[i];
      o[c] = v instanceof Uint8Array ? v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength) : v;
    });
    return o;
  });
}

/** Test hook: stop every reader process and forget the queue. */
export async function resetLocalReads(): Promise<void> {
  const old = slots.splice(0, slots.length);
  queue.length = 0;
  for (const s of old) s.worker.kill("SIGKILL");
}
