export type WorkflowLogEntry = {
  number: number;
  text: string;
  timestamp: string;
  tone: "normal" | "error" | "warning";
  children?: WorkflowLogEntry[];
};

const displayLineLimit = 10_000;

/** Parse runner timestamps, ANSI controls and nested GitHub log groups as text. */
export function parseWorkflowLog(content: string) {
  const entries: WorkflowLogEntry[] = [];
  const stack: WorkflowLogEntry[][] = [entries];
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  if (lines.at(-1) === "") lines.pop();
  const truncated = lines.length > displayLineLimit;
  for (
    let index = 0;
    index < Math.min(lines.length, displayLineLimit);
    index++
  ) {
    const clean = lines[index]
      // Strip terminal styling and OSC hyperlinks; render all output as plain text.
      .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
      .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
      .replace(/\r/g, "");
    const match =
      /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z) ?(.*)$/.exec(clean);
    const timestamp = match?.[1] ?? "";
    let text = match?.[2] ?? clean;
    if (text.startsWith("##[endgroup]")) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const group = text.startsWith("##[group]");
    const tone = text.startsWith("##[error]")
      ? "error"
      : text.startsWith("##[warning]")
        ? "warning"
        : "normal";
    text = text.replace(
      /^##\[(?:group|error|warning|notice|command|debug|section)\]/,
      "",
    );
    const entry: WorkflowLogEntry = {
      number: index + 1,
      text,
      timestamp,
      tone,
    };
    stack.at(-1)!.push(entry);
    // Runner groups are normally shallow; bound nesting for malformed logs.
    if (group && stack.length < 32) {
      entry.children = [];
      stack.push(entry.children);
    }
  }
  return { entries, truncated };
}
