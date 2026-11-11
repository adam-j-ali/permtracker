"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { CaretRightIcon, CheckIcon, WarningIcon } from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PERM_CASE, validateTimeline, type TimelineInput, type TimelineStatus } from "@/lib/communityTimeline";
import { SITE_URL } from "@/lib/constants/site";

import { TimelineFormFields } from "./TimelineFormFields";
import {
  adoptKey,
  canShare,
  forgetKey,
  isEditKey,
  loadMine,
  newKey,
  ownKey,
  rememberKey,
  removeTimeline,
  saveTimeline,
  statusNote,
} from "./timelineClient";

/**
 * Share your own dates, from a USCIS office's page or the timelines page. No account and no case number needed:
 * the short form is the office, four dates, a category and a country, with the rest behind one fold.
 *
 * - `office` prefills the office (USCIS's code) on that office's page; the person can change it.
 * - A saved timeline waits for a review before it shows anywhere, and the form says so the moment it's saved.
 * - A returning author's form stays folded under "Your timeline", with its status above the fold.
 * - After saving: a link to copy for the page's list, and the edit code, which opens the same timeline on
 *   another device. The code is the browser's key. It's shown only on request and never put in an address.
 *
 * Renders nothing when the build has no backend to post to.
 */

type State = { kind: "idle" } | { kind: "sending" } | { kind: "done" | "refused"; message: string };

const copy = async (text: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
};

export function ShareTimeline({
  office,
  sharePath,
  shareLabel,
  className,
}: {
  /** USCIS's code for the office whose page this is; prefilled in the form. */
  office?: string;
  /** The page whose list this timeline joins, for the copy-link button ("/i485-by-field-office/hartford-connecticut#timelines"). */
  sharePath: string;
  /** "Hartford's timelines": what the copied link leads to. */
  shareLabel: string;
  className?: string;
}) {
  const uid = useId();
  const empty = useMemo<TimelineInput>(() => ({ route: "adjustment", public: false, ...(office ? { fieldOffice: office } : {}) }), [office]);
  const [form, setForm] = useState<TimelineInput>(empty);
  const [caseNumber, setCaseNumber] = useState("");
  const [key, setKey] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [status, setStatus] = useState<TimelineStatus | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<State>({ kind: "idle" });
  const [copied, setCopied] = useState<"link" | "code" | null>(null);
  const [code, setCode] = useState("");
  const [codeNote, setCodeNote] = useState("");
  const [usable, setUsable] = useState(false);

  const adopt = async (k: string, fromCode: boolean) => {
    setLoading(true);
    const mine = await loadMine(k);
    setLoading(false);
    if (!mine) {
      if (fromCode) setCodeNote("That code doesn't open a timeline. Check that all of it was copied.");
      return;
    }
    if (fromCode) adoptKey(k);
    setKey(k);
    setSaved(true);
    setStatus(mine.status);
    setForm({ ...empty, ...mine.input });
    setCaseNumber(mine.caseNumber ?? "");
    // A returning author's form stays folded, so the page's own figures stay in view; a pasted code opens it.
    if (fromCode) setOpen(true);
    setCode("");
    setCodeNote("");
  };

  useEffect(() => {
    setUsable(canShare());
    if (window.location.hash === "#share") setOpen(true);
    const k = ownKey();
    if (k) void adopt(k, false);
    // Runs once: the key is this browser's, whatever page the form sits on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const check = useMemo(() => validateTimeline(form), [form]);
  if (!usable) return null;

  const set = <K extends keyof TimelineInput>(k: K, v: TimelineInput[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    if (state.kind !== "sending") setState({ kind: "idle" });
  };

  async function save(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (state.kind === "sending") return;
    if (!check.ok) {
      setState({ kind: "refused", message: check.message });
      return;
    }
    const typed = caseNumber.trim().toUpperCase();
    if (typed !== "" && !PERM_CASE.test(typed)) {
      setState({ kind: "refused", message: "That isn't a PERM case number. Leave the box empty if the case has none." });
      return;
    }
    const k = key ?? newKey();
    setState({ kind: "sending" });
    const reply = await saveTimeline(k, typed || null, form);
    if (reply.ok) {
      rememberKey(k, typed || null);
      setKey(k);
      setSaved(true);
      setStatus(reply.status);
    }
    setState({ kind: reply.ok ? "done" : "refused", message: reply.message });
  }

  async function remove() {
    if (!key || state.kind === "sending") return;
    setState({ kind: "sending" });
    const reply = await removeTimeline(key);
    if (reply.ok) {
      forgetKey(key);
      setKey(null);
      setSaved(false);
      setStatus(undefined);
      setForm(empty);
      setCaseNumber("");
    }
    setState({ kind: reply.ok ? "done" : "refused", message: reply.message });
  }

  async function openWithCode(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const k = code.trim().toLowerCase();
    if (!isEditKey(k)) {
      setCodeNote("An edit code is 64 letters and digits. Check that all of it was copied.");
      return;
    }
    await adopt(k, true);
  }

  const flash = (what: "link" | "code", ok: boolean) => {
    if (!ok) return;
    setCopied(what);
    window.setTimeout(() => setCopied(null), 2000);
  };
  const note = saved ? statusNote(status) : null;

  return (
    <div id="share" className={className}>
      {/* Above the fold, so a returning author reads where their timeline stands without opening it. */}
      {note ? (
        <p role="status" className="mb-3 border-2 border-border bg-soft-wait p-3 text-base">
          {note}
        </p>
      ) : null}
      <details className="group border-t-2 border-border" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
        <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-lg font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
          <CaretRightIcon className="size-4 shrink-0 transition-transform group-open:rotate-90" weight="bold" aria-hidden="true" />{" "}
          {saved ? "Your timeline" : loading ? "Loading your timeline…" : "Add your dates"}
        </summary>

        <form onSubmit={save} className="mt-4 space-y-6" noValidate>
          <TimelineFormFields uid={uid} variant="open" form={form} set={set} caseNumber={caseNumber} onCaseNumber={setCaseNumber} />{" "}
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" loading={state.kind === "sending"}>
              {saved ? "Save changes" : "Save my timeline"}
            </Button>{" "}
            {saved ? (
              <Button type="button" variant="ghost" onClick={remove} disabled={state.kind === "sending"}>
                Remove my timeline
              </Button>
            ) : null}
          </div>{" "}
          {state.kind === "done" ? (
            <p role="status" className="flex items-start gap-2 text-base">
              <CheckIcon size={18} weight="bold" className="mt-1 shrink-0 text-primary-text" aria-hidden="true" /> {state.message}
            </p>
          ) : state.kind === "refused" ? (
            <p role="alert" className="flex items-start gap-2 text-base">
              <WarningIcon size={18} weight="bold" className="mt-1 shrink-0" aria-hidden="true" /> {state.message}
            </p>
          ) : null}
        </form>

        {saved && key ? (
          <div className="mt-6 flex flex-wrap items-center gap-3 border-t-2 border-border pt-4">
            <Button type="button" variant="outline" onClick={async () => flash("link", await copy(`${SITE_URL}${sharePath}`))}>
              {copied === "link" ? "Link copied" : `Copy the link to ${shareLabel}`}
            </Button>{" "}
            <Button type="button" variant="outline" className="ph-no-capture" onClick={async () => flash("code", await copy(key))}>
              {copied === "code" ? "Edit code copied" : "Copy my edit code"}
            </Button>{" "}
            <p className="basis-full text-sm leading-relaxed text-muted-foreground">
              The edit code opens this timeline on another phone or computer. Anyone who has it can change or remove the timeline, so keep it
              to yourself.
            </p>
          </div>
        ) : (
          <form onSubmit={openWithCode} className="mt-6 border-t-2 border-border pt-4" noValidate>
            <Label htmlFor={`${uid}-code`}>Saved one on another device? Paste its edit code</Label>
            <div className="mt-1.5 flex flex-wrap gap-3">
              <Input
                id={`${uid}-code`}
                value={code}
                onChange={(e) => {
                  setCode(e.target.value);
                  setCodeNote("");
                }}
                autoComplete="off"
                spellCheck={false}
                className="ph-no-capture min-w-0 flex-1 basis-64 font-mono"
                aria-describedby={codeNote ? `${uid}-code-note` : undefined}
              />{" "}
              <Button type="submit" variant="outline" loading={loading}>
                Open it
              </Button>
            </div>
            {codeNote ? (
              <p id={`${uid}-code-note`} role="alert" className="mt-2 text-base">
                {codeNote}
              </p>
            ) : null}
          </form>
        )}
      </details>
    </div>
  );
}
