package gitrepo

import (
	"strings"

	"github.com/sergi/go-diff/diffmatchpatch"
)

// Line is one selectable source line. Text retains its original line ending.
type Line struct {
	Kind string
	Text string
	Old  int
	New  int
}

// DiffLines computes line changes without importing a UI implementation.
func DiffLines(before, after string) []Line {
	d := diffmatchpatch.New()
	a, b, lines := d.DiffLinesToRunes(before, after)
	diffs := d.DiffCharsToLines(d.DiffMainRunes(a, b, false), lines)
	result := make([]Line, 0)
	oldLine, newLine := 1, 1
	for _, change := range diffs {
		for _, text := range strings.SplitAfter(change.Text, "\n") {
			if text == "" {
				continue
			}
			line := Line{Kind: "context", Text: text, Old: oldLine, New: newLine}
			switch change.Type {
			case diffmatchpatch.DiffInsert:
				line.Kind, line.Old = "add", 0
				newLine++
			case diffmatchpatch.DiffDelete:
				line.Kind, line.New = "delete", 0
				oldLine++
			default:
				oldLine++
				newLine++
			}
			result = append(result, line)
		}
	}
	return result
}

func diffStats(before, after string) (added, deleted int) {
	for _, line := range DiffLines(before, after) {
		switch line.Kind {
		case "add":
			added++
		case "delete":
			deleted++
		}
	}
	return
}

// PickText applies only the chosen changed lines to the old text.
func PickText(lines []Line, selected map[int]bool) string {
	var text strings.Builder
	for i, line := range lines {
		if line.Kind == "context" || line.Kind == "add" && selected[i] || line.Kind == "delete" && !selected[i] {
			text.WriteString(line.Text)
		}
	}
	return text.String()
}
