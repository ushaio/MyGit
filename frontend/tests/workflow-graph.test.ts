import { expect, it } from "vitest";
import type { WorkflowJob } from "@/lib/api";
import { buildWorkflowGraph, fitWorkflowGraph, zoomWorkflowGraph } from "@/lib/workflow-graph";

function job(ID: number, Name: string): WorkflowJob {
  return { ID, Name, RunID: 1, Status: "completed", Conclusion: "success", StartedAt: "", CompletedAt: "", Steps: [] };
}

it("groups matrix jobs and lays out a fan-out and join from needs, independent of API ordering", () => {
  const graph = buildWorkflowGraph([
    job(4, "Deploy"), job(2, "Build (windows)"), job(3, "Lint"), job(1, "Build (linux)"),
  ], [
    { ID: "deploy", Name: "Deploy", Needs: ["build", "lint"] },
    { ID: "lint", Name: "Lint", Needs: ["prepare"] },
    { ID: "build", Name: "Build", Needs: ["prepare"] },
    { ID: "prepare", Name: "Prepare", Needs: [] },
  ]);
  const [deploy, lint, build, prepare] = graph.nodes;
  expect(build.jobs.map((item) => item.ID)).toEqual([2, 1]);
  expect(prepare.jobs).toEqual([]);
  expect(prepare.x).toBeLessThan(build.x);
  expect(build.x).toBe(lint.x);
  expect(build.x).toBeLessThan(deploy.x);
  expect(graph.edges).toHaveLength(4);
  expect(graph.incomplete).toBe(false);
  expect(lint.y + lint.height).toBeLessThan(build.y);
  for (const node of graph.nodes) {
    expect(node.x + node.width).toBeLessThanOrEqual(graph.width);
    expect(node.y + node.height).toBeLessThanOrEqual(graph.height);
  }
});

it("matches expression names, escapes punctuation, and leaves ambiguous or reusable jobs unconnected", () => {
  const graph = buildWorkflowGraph([
    job(1, "Build [release] (windows)"),
    job(2, "Test"),
    job(3, "Call / inner"),
  ], [
    { ID: "build", Name: "Build [release] (${{ matrix.os }})", Needs: [] },
    { ID: "first", Name: "Test", Needs: [] },
    { ID: "second", Name: "Test", Needs: [] },
    { ID: "call", Name: "Call", Needs: ["build"] },
  ]);
  expect(graph.nodes[0].jobs[0]?.ID).toBe(1);
  expect(graph.nodes[1].jobs).toEqual([]);
  expect(graph.nodes[2].jobs).toEqual([]);
  expect(graph.nodes.find((node) => node.id === "job:2")?.needs).toEqual([]);
  expect(graph.nodes.find((node) => node.id === "job:3")?.needs).toEqual([]);
  expect(graph.incomplete).toBe(true);
});

it("does not invent dependencies without YAML and terminates for cycles or missing IDs", () => {
  expect(buildWorkflowGraph([job(1, "First"), job(2, "Second")]).edges).toEqual([]);
  const graph = buildWorkflowGraph([], [
    { ID: "a", Name: "A", Needs: ["b"] },
    { ID: "b", Name: "B", Needs: ["a"] },
    { ID: "c", Name: "C", Needs: ["missing"] },
  ]);
  expect(graph.edges).toEqual([]);
  expect(graph.incomplete).toBe(true);
  expect(graph.nodes.every((node) => Number.isFinite(node.y))).toBe(true);
});

it("fits a small viewport and keeps the point under the cursor fixed when zooming", () => {
  const fit = fitWorkflowGraph({ width: 1000, height: 400 }, { width: 500, height: 300 });
  expect(fit).toEqual({ x: 0, y: 50, zoom: 0.5 });
  const origin = { x: 100, y: 100 };
  const zoomed = zoomWorkflowGraph(fit, 1, origin);
  expect((origin.x - fit.x) / fit.zoom).toBe((origin.x - zoomed.x) / zoomed.zoom);
  expect((origin.y - fit.y) / fit.zoom).toBe((origin.y - zoomed.y) / zoomed.zoom);
  expect(zoomWorkflowGraph(fit, 20, origin).zoom).toBe(1.5);
  expect(zoomWorkflowGraph(fit, 0.01, origin).zoom).toBe(0.2);
});
