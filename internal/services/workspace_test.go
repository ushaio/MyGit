package services

import (
	"os"
	"path/filepath"
	"testing"

	"mygit-wails3/internal/workspace"
)

func TestDataPathCreatesTheFolder(t *testing.T) {
	config := filepath.Join(t.TempDir(), "data")
	store, err := workspace.NewStore(config)
	if err != nil {
		t.Fatal(err)
	}
	dir, err := NewWorkspaceService(store).DataPath()
	if err != nil {
		t.Fatal(err)
	}
	if dir != config {
		t.Fatalf("data directory: %s", dir)
	}
	if info, err := os.Stat(dir); err != nil || !info.IsDir() {
		t.Fatal("the data directory was not created")
	}
}
