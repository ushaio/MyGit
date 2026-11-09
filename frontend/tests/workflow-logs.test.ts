import { expect, it } from "vitest";
import { parseWorkflowLog } from "@/lib/workflow-logs";

it("preserves original line numbers while parsing timestamps and nested groups", () => {
  const content = [
    "2026-01-01T00:00:00.0000000Z Current runner version: '2.338.2'",
    "2026-01-01T00:00:01Z ##[group]Runner Image",
    "2026-01-01T00:00:02Z Windows Server",
    "2026-01-01T00:00:03Z ##[group]Image details",
    "2026-01-01T00:00:04Z Build: 20260101",
    "2026-01-01T00:00:05Z ##[endgroup]",
    "2026-01-01T00:00:06Z ##[endgroup]",
    "2026-01-01T00:00:07Z Prepare workflow directory",
    "",
  ].join("\r\n");
  const { entries, truncated } = parseWorkflowLog(content);
  expect(truncated).toBe(false);
  expect(entries.map(({ number, text }) => [number, text])).toEqual([
    [1, "Current runner version: '2.338.2'"],
    [2, "Runner Image"],
    [8, "Prepare workflow directory"],
  ]);
  expect(entries[0].timestamp).toBe("2026-01-01T00:00:00.0000000Z");
  expect(entries[1].children?.[1].children?.[0].text).toBe("Build: 20260101");
});

it("strips terminal escape sequences and retains raw text and error severity", () => {
  const { entries } = parseWorkflowLog(
    "\x1b[31m##[error]Failed <script>alert(1)</script>\x1b[0m\n\x1b]8;;https://example.com\x07link\x1b]8;;\x07\n##[warning]Careful\n",
  );
  expect(entries[0]).toMatchObject({
    text: "Failed <script>alert(1)</script>",
    tone: "error",
  });
  expect(entries[1].text).toBe("link");
  expect(entries[2]).toMatchObject({ text: "Careful", tone: "warning" });
});

it("handles unclosed groups and empty logs and bounds large displays", () => {
  expect(parseWorkflowLog("").entries).toEqual([]);
  expect(
    parseWorkflowLog("##[endgroup]\n##[group]Unclosed\nOutput").entries[0]
      .children?.[0].text,
  ).toBe("Output");
  const large = parseWorkflowLog("Output\n".repeat(10_001));
  expect(large.truncated).toBe(true);
  expect(large.entries).toHaveLength(10_000);
});
