package services

import (
	"context"
	"strings"
	"testing"
)

type recordingFiles struct {
	name string
	data []byte
}

func (r *recordingFiles) openVersion(name string, data []byte) error {
	r.name, r.data = name, append([]byte(nil), data...)
	return nil
}
func (r *recordingFiles) saveVersion(name string, data []byte) error {
	return r.openVersion(name, data)
}

func TestExportReadsHistoricalVersion(t *testing.T) {
	s, path := testService(t)
	hash := testGit(t, path, "rev-parse", "HEAD")
	write(t, path, "a.txt", "new working copy\n")
	files := &recordingFiles{}
	s.AttachFiles(files)
	req := FileRequest{Request: ChangeRequest{Path: path, Mode: "files", Revision: hash}, File: "a.txt"}
	if err := s.ExportFile(req, "open"); err != nil {
		t.Fatal(err)
	}
	if files.name != "a.txt" || string(files.data) != "one\nold\ntail\n" {
		t.Fatalf("opened current worktree instead of historical version: %q %q", files.name, files.data)
	}
}
func TestExportPreservesBinaryBytes(t *testing.T) {
	s, path := testService(t)
	write(t, path, "binary.dat", "\x00\x01\xff\n")
	files := &recordingFiles{}
	s.AttachFiles(files)
	if err := s.ExportFile(fileRequest(path, "binary.dat", 2), "save"); err != nil {
		t.Fatal(err)
	}
	if string(files.data) != "\x00\x01\xff\n" {
		t.Fatalf("export changed binary bytes: %v", files.data)
	}
}
func TestCommitAndPushReportsPartialSuccess(t *testing.T) {
	s, path := testService(t)
	write(t, path, "a.txt", "new\n")
	testGit(t, path, "add", "a.txt")
	err := s.Execute(context.Background(), Action{Path: path, Kind: "commit", Message: "recorded", Mode: "push"})
	if err == nil || !strings.Contains(err.Error(), "commit recorded, but push failed") {
		t.Fatalf("missing partial-success message: %v", err)
	}
	if message := testGit(t, path, "log", "-1", "--format=%s"); message != "recorded" {
		t.Fatal("commit was not recorded")
	}
}
