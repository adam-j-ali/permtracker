"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckIcon, CopyIcon } from "@phosphor-icons/react";

import { buttonVariants } from "@/components/ui/button";

/**
 * Copy a piece of text, and say truthfully whether it worked.
 *
 * The clipboard can be refused (an insecure origin, a permission policy, an older browser). Then the button says
 * to select the text by hand: the host keeps the text on the page for that, so the button is never the only way.
 * The word on the button changes and a polite live region repeats it, so a screen reader hears the result too.
 */
export function CopyButton({
  text,
  label = "Copy",
  variant = "outline",
  onCopied,
  className,
}: {
  text: string;
  /** What the button says before it's pressed: "Copy", "Copy the line". */
  label?: string;
  variant?: "default" | "outline" | "secondary";
  /** Called after a copy that worked (an analytics event, say). */
  onCopied?: () => void;
  className?: string;
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const copy = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
      onCopied?.();
      timer.current = setTimeout(() => setState("idle"), 2000);
    } catch {
      setState("failed");
      timer.current = setTimeout(() => setState("idle"), 4000);
    }
  }, [text, onCopied]);

  const says = state === "copied" ? "Copied" : state === "failed" ? "Select the text to copy" : label;
  return (
    <button type="button" onClick={copy} className={buttonVariants({ variant, size: "default", className: `shrink-0 ${className ?? ""}` })}>
      {state === "copied" ? <CheckIcon size={16} weight="bold" aria-hidden="true" /> : <CopyIcon size={16} weight="bold" aria-hidden="true" />}
      <span aria-live="polite">{says}</span>
    </button>
  );
}
