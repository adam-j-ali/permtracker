"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { blockFromInput } from "@/lib/uscisSample";

/**
 * A receipt number or block name in, that block's page out. Only online (IOE) numbers come in blocks; anything else
 * gets a plain line saying so, and the lookup page for its own status.
 */
export function BlockSearch({ defaultValue = "" }: { defaultValue?: string }) {
  const router = useRouter();
  const id = useId();
  const [value, setValue] = useState(defaultValue);
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <form
      className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto] sm:items-end [&>*]:min-w-0"
      onSubmit={(e) => {
        e.preventDefault();
        const block = blockFromInput(value);
        if (!block) {
          setProblem(
            "Blocks are for online (IOE) numbers. Type one like IOE0000000000, or a block like IOE09366. A paper filing's number (EAC, WAC, LIN, SRC, NBC, MSC) has no block.",
          );
          return;
        }
        setProblem(null);
        router.push(`/uscis-receipt-blocks/${block}`);
      }}
    >
      <div>
        <label htmlFor={id} className="text-base font-bold">
          Your receipt number or block
        </label>{" "}
        <Input
          id={id}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="IOE09366"
          autoComplete="off"
          spellCheck={false}
          className="mt-2 font-mono text-base"
          aria-describedby={problem ? `${id}-problem` : undefined}
        />
      </div>{" "}
      <Button type="submit" className="min-h-11">
        Show the block
      </Button>{" "}
      {problem ? (
        <p id={`${id}-problem`} role="status" className="text-base text-data-warn-ink sm:col-span-2">
          {problem}
        </p>
      ) : null}
    </form>
  );
}
