import { describe, expect, it } from "vitest"
import { buildGraph, foldCommits } from "@/lib/graph"
import { changedRange, splitLines } from "@/lib/diff"
import { action } from "@/lib/api"
import { collectProjects } from "@/lib/workbench"
import { alpha, commit, createBackend } from "./backend"

describe("commit graph", () => {
  it("keeps a linear history in one lane", () => {
    const rows = buildGraph([commit("c", "third", ["b"]), commit("b", "second", ["a"]), commit("a")])
    expect(rows.map(row => row.column)).toEqual([0, 0, 0])
    expect(rows.map(row => row.columns)).toEqual([1, 1, 1])
    expect(rows.at(-1)?.lines[0].bottom).toBe(-1)
  })
  it("opens merge lanes and hides only the merged side", () => {
    const commits = [commit("m", "merge", ["main", "side"]), commit("main", "main", ["base"]), commit("side", "side", ["base"]), commit("base")]
    const rows = buildGraph(commits)
    expect(rows[0].columns).toBe(2)
    expect(rows.at(-1)?.lines).toHaveLength(2)
    expect([...foldCommits(commits, new Set(["m"])).keys()]).toEqual(["side"])
  })
  it("retains a side commit that another visible branch needs", () => {
    const commits = [commit("other", "other", ["side"]), commit("m", "merge", ["main", "side"]), commit("main", "main", ["base"]), commit("side", "side", ["base"]), commit("base")]
    expect(foldCommits(commits, new Set(["m"])).has("side")).toBe(false)
  })
})
describe("diff presentation", () => {
  const lines = [{ Kind: "context", Text: "a\n", Old: 1, New: 1 }, { Kind: "delete", Text: "old\n", Old: 2, New: 0 }, { Kind: "add", Text: "new\n", Old: 0, New: 2 }, { Kind: "add", Text: "extra", Old: 0, New: 3 }]
  it("pairs removed and added lines while retaining source indices", () => {
    const rows = splitLines(lines)
    expect(rows).toHaveLength(3)
    expect(rows[1]).toMatchObject({ leftIndex: 1, rightIndex: 2 })
    expect(rows[2].left).toBeUndefined()
    expect(rows[2].right?.Text).toBe("extra")
  })
  it("selects changed lines in either direction without context", () => { expect(changedRange(lines, 3, 0)).toEqual([1, 2, 3]) })
})
it("does not preconfirm an action", () => { expect(action("reset", alpha)).toMatchObject({ Path: alpha, Confirm: false, Force: false }) })
it("excludes removed projects and removed roots from navigation", () => {
  const { state } = createBackend()
  state.Trees![0]!.Children![0]!.Removed = true
  expect(collectProjects(state).map(p => p.Path)).not.toContain(alpha)
  state.Roots = []
  expect(collectProjects(state)).toEqual([])
})
