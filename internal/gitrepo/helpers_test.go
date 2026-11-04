package gitrepo

import (
	"os"
	"path/filepath"
	"testing"
)

func testRepo(t *testing.T) string {
	t.Helper()
	repo, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	git(t, repo, "init", "-q", "-b", "main")
	if err := os.WriteFile(filepath.Join(repo, "a.txt"), []byte("1\n"), 0644); err != nil {
		t.Fatal(err)
	}
	git(t, repo, "add", ".")
	git(t, repo, "commit", "-q", "-m", "init")
	git(t, repo, "tag", "v1")
	return repo
}

func TestDiffAndSelectedLines(t *testing.T) {
	before, after := "one\nold\ntail", "one\nnew\nadded\ntail"
	lines := DiffLines(before, after)
	if got := PickText(lines, nil); got != before {
		t.Fatalf("empty selection: %q", got)
	}
	all := map[int]bool{}
	for i, line := range lines {
		if line.Kind != "context" {
			all[i] = true
		}
	}
	if got := PickText(lines, all); got != after {
		t.Fatalf("all changes: %q", got)
	}
	if added, deleted := diffStats(before, after); added != 2 || deleted != 1 {
		t.Fatalf("statistics: %d %d", added, deleted)
	}
	if got := PickText(DiffLines("a\r\n", "b\r\n"), map[int]bool{0: true, 1: true}); got != "b\r\n" {
		t.Fatalf("line endings: %q", got)
	}
}
