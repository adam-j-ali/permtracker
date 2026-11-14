/**
 * Both SDKs wrap every operation the API has.
 *
 * The SDKs are their own packages and can't import the registry, so this holds them to it from outside: an
 * operation added to the registry needs a method in each SDK and a line here, or this fails.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { API_VERSION, ENDPOINTS } from "../openapi";

const ROOT = join(__dirname, "..", "..", "..", "..");
const JS = readFileSync(join(ROOT, "sdk", "src", "index.ts"), "utf8");
const PY = readFileSync(join(ROOT, "sdk-python", "permtracker", "__init__.py"), "utf8");

/** Each operation's method in the JavaScript SDK and in the Python one. */
const METHODS: Record<string, { js: string; py: string }> = {
  getCase: { js: "case", py: "case" },
  findCases: { js: "findCases", py: "find_cases" },
  estimateDecision: { js: "estimate", py: "estimate" },
  getQueue: { js: "queue", py: "queue" },
  getVisaBulletin: { js: "visaBulletin", py: "visa_bulletin" },
  searchEmployers: { js: "employers", py: "employers" },
  getEmployer: { js: "employer", py: "employer" },
  searchLawFirms: { js: "lawFirms", py: "law_firms" },
  getLawFirm: { js: "lawFirm", py: "law_firm" },
  searchOccupations: { js: "occupations", py: "occupations" },
  getOccupation: { js: "occupation", py: "occupation" },
  lookupEmployer: { js: "lookupEmployer", py: "lookup_employer" },
  lookupSoc: { js: "lookupSoc", py: "lookup_soc" },
  exportRecords: { js: "export", py: "export" },
  listWebhooks: { js: "webhooks", py: "webhooks" },
  createWebhook: { js: "createWebhook", py: "create_webhook" },
  deleteWebhook: { js: "deleteWebhook", py: "delete_webhook" },
  listWatches: { js: "watches", py: "watches" },
  createWatch: { js: "watch", py: "watch" },
  deleteWatch: { js: "unwatch", py: "unwatch" },
  getMe: { js: "me", py: "me" },
  getHealth: { js: "health", py: "health" },
};

describe("the SDKs cover the API", () => {
  it("has a line here for every operation in the registry, and no line for one that's gone", () => {
    expect(Object.keys(METHODS).sort()).toEqual(ENDPOINTS.map((e) => e.id).sort());
  });

  it("has each operation's method in the JavaScript SDK, calling its path", () => {
    for (const e of ENDPOINTS) {
      const name = METHODS[e.id]!.js;
      expect(new RegExp(`^  (?:async )?${name}\\(`, "m").test(JS), `${e.id}: sdk/src/index.ts has no ${name}()`).toBe(true);
      const stem = e.path.split("{")[0]!.replace(/\/$/, "");
      expect(JS.includes(`"${stem}`) || JS.includes(`\`${stem}`), `${e.id}: no call to ${stem}`).toBe(true);
    }
  });

  it("has each operation's method in the Python SDK, calling its path", () => {
    for (const e of ENDPOINTS) {
      const name = METHODS[e.id]!.py;
      expect(new RegExp(`^    def ${name}\\(`, "m").test(PY), `${e.id}: sdk-python has no ${name}()`).toBe(true);
      const stem = e.path.split("{")[0]!.replace(/\/$/, "");
      expect(PY.includes(`"${stem}`), `${e.id}: no call to ${stem}`).toBe(true);
    }
  });

  it("keeps the two SDKs on one version", () => {
    const js = /export const VERSION = "([\d.]+)"/.exec(JS)?.[1];
    const py = /__version__ = "([\d.]+)"/.exec(PY)?.[1];
    expect(js).toBeTruthy();
    expect(py).toBe(js);
    expect(readFileSync(join(ROOT, "sdk", "package.json"), "utf8")).toContain(`"version": "${js}"`);
    expect(readFileSync(join(ROOT, "sdk-python", "pyproject.toml"), "utf8")).toContain(`version = "${js}"`);
    // The API's own version is a different number, and says so in the registry.
    expect(API_VERSION).toMatch(/^1\./);
  });
});
