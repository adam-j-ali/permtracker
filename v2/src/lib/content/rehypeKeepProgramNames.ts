/**
 * A rehype plugin that keeps every program and form name in an article on one line: each H-1B, CW-1, I-140 or
 * ETA-9089 in the text goes into a no-wrap span, the MDX form of KeepWhole (src/components/ui/keep-whole.tsx).
 * Code and preformatted text are left exactly as written, and so are a component's props, which are
 * expressions rather than text. The rule and its list are in src/lib/programNames.ts.
 */
import { programNameRuns } from "@/lib/programNames";

/** The parts of a hast node this plugin reads: text has a value, elements and MDX components have children. */
interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

/** Elements whose text is shown exactly as written. */
const AS_WRITTEN = new Set(["code", "pre", "kbd", "samp", "script", "style", "svg", "math", "textarea"]);

function keepNames(node: HastNode): void {
  if (!node.children || (node.type === "element" && AS_WRITTEN.has(node.tagName ?? ""))) return;
  const out: HastNode[] = [];
  let changed = false;
  for (const child of node.children) {
    if (child.type === "text" && typeof child.value === "string") {
      const runs = programNameRuns(child.value);
      if (runs.some((r) => r.name)) {
        changed = true;
        for (const r of runs) {
          out.push(
            r.name
              ? { type: "element", tagName: "span", properties: { className: ["whitespace-nowrap"] }, children: [{ type: "text", value: r.text }] }
              : { type: "text", value: r.text },
          );
        }
        continue;
      }
    } else {
      keepNames(child);
    }
    out.push(child);
  }
  if (changed) node.children = out;
}

export function rehypeKeepProgramNames() {
  return (tree: HastNode) => {
    keepNames(tree);
  };
}
