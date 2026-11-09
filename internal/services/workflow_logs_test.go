package services

import (
	"archive/zip"
	"bytes"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
)

type workflowLogTestEntry struct {
	name, content string
}

func workflowLogTestZIP(t *testing.T, entries ...workflowLogTestEntry) []byte {
	t.Helper()
	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	for _, entry := range entries {
		file, err := writer.Create(entry.name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := io.WriteString(file, entry.content); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}

func workflowLogTestService(t *testing.T, server *httptest.Server) *WorkflowService {
	t.Helper()
	service := newTestService(t, server)
	if err := service.creds.Set(workflowKeyringService, credentialAccount("github", "github.com"), "secret-token"); err != nil {
		t.Fatal(err)
	}
	return service
}

func TestWorkflowJobLogsMapsActualStepFiles(t *testing.T) {
	grouped := "2026-11-08T10:00:00Z ##[group]Build\n2026-11-08T10:00:01Z only build output\n2026-11-08T10:00:02Z ##[endgroup]\n"
	archive := workflowLogTestZIP(t,
		workflowLogTestEntry{"Build & Package (linux)/3_Build.txt", grouped},
		workflowLogTestEntry{"Build & Package (linux)/1_Set up job.txt", "setup only\n"},
		workflowLogTestEntry{"Build & Package (linux)/8_Complete job.txt", "done\n"},
		workflowLogTestEntry{"Build & Package (linux)/99_Unknown.txt", "not in metadata"},
		workflowLogTestEntry{"0_Build & Package (linux).txt", "aggregate must never appear"},
		workflowLogTestEntry{"Build & Package (windows)/3_Build.txt", "wrong matrix job"},
	)
	var routes []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		routes = append(routes, r.URL.Path)
		if r.Header.Get("Authorization") != "Bearer secret-token" {
			t.Errorf("API Authorization = %q", r.Header.Get("Authorization"))
		}
		switch r.URL.Path {
		case "/repos/owner/repo/actions/jobs/20":
			io.WriteString(w, `{"id":20,"run_id":10,"name":"Build & Package (linux)","steps":[{"number":1},{"number":2},{"number":3},{"number":8}]}`)
		case "/repos/owner/repo/actions/runs/10/logs":
			w.Write(archive)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	got, err := workflowLogTestService(t, server).JobLogs(githubTestTarget(), 10, 20)
	if err != nil {
		t.Fatal(err)
	}
	want := []WorkflowStepLog{{Number: 1, Content: "setup only\n"}, {Number: 3, Content: grouped}, {Number: 8, Content: "done\n"}}
	if !reflect.DeepEqual(got.Steps, want) {
		t.Fatalf("steps = %+v, want %+v", got.Steps, want)
	}
	if len(routes) != 2 {
		t.Fatalf("routes = %v", routes)
	}
}

func TestWorkflowJobLogsUsesJobAttemptIncludingFirstAttempt(t *testing.T) {
	for _, attempt := range []int{1, 3} {
		t.Run(fmt.Sprint(attempt), func(t *testing.T) {
			archive := workflowLogTestZIP(t, workflowLogTestEntry{"Build/1_Set up job.txt", "correct attempt"})
			var requested string
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if strings.HasSuffix(r.URL.Path, "/jobs/20") {
					fmt.Fprintf(w, `{"id":20,"run_id":10,"run_attempt":%d,"name":"Build","steps":[{"number":1}]}`, attempt)
					return
				}
				requested = r.URL.Path
				w.Write(archive)
			}))
			defer server.Close()
			_, err := workflowLogTestService(t, server).JobLogs(githubTestTarget(), 10, 20)
			if err != nil {
				t.Fatal(err)
			}
			want := fmt.Sprintf("/repos/owner/repo/actions/runs/10/attempts/%d/logs", attempt)
			if requested != want {
				t.Fatalf("download path = %q, want %q", requested, want)
			}
		})
	}
}

func TestWorkflowJobLogsRejectsMismatchedJobAndRun(t *testing.T) {
	for _, metadata := range []string{
		`{"id":20,"run_id":999,"name":"Build"}`,
		`{"id":999,"run_id":10,"name":"Build"}`,
	} {
		t.Run(metadata, func(t *testing.T) {
			var requests atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				requests.Add(1)
				io.WriteString(w, metadata)
			}))
			defer server.Close()
			got, err := workflowLogTestService(t, server).JobLogs(githubTestTarget(), 10, 20)
			if err == nil || !strings.Contains(err.Error(), "不属于") || len(got.Steps) != 0 || requests.Load() != 1 {
				t.Fatalf("result = %+v, error = %v, requests = %d", got, err, requests.Load())
			}
		})
	}
}

func TestWorkflowJobLogsRedirectsNeverForwardAuthorization(t *testing.T) {
	archive := workflowLogTestZIP(t, workflowLogTestEntry{"Build/1_Set up job.txt", "only step"})
	var downloadRequests atomic.Int32
	download := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		downloadRequests.Add(1)
		if got := r.Header.Get("Authorization"); got != "" {
			t.Errorf("download Authorization = %q; token leaked", got)
		}
		if got := r.Header.Get("Cookie"); got != "" {
			t.Errorf("download Cookie = %q", got)
		}
		if r.URL.Path == "/first" {
			http.Redirect(w, r, "/archive", http.StatusTemporaryRedirect)
			return
		}
		w.Write(archive)
	}))
	defer download.Close()
	var apiRequests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/same-host-download" {
			if got := r.Header.Get("Authorization"); got != "" {
				t.Errorf("same-host redirect Authorization = %q", got)
			}
			http.Redirect(w, r, download.URL+"/first", http.StatusFound)
			return
		}
		apiRequests.Add(1)
		if got := r.Header.Get("Authorization"); got != "Bearer secret-token" {
			t.Errorf("API Authorization = %q", got)
		}
		if strings.HasSuffix(r.URL.Path, "/jobs/20") {
			io.WriteString(w, `{"id":20,"run_id":10,"name":"Build","steps":[{"number":1}]}`)
			return
		}
		http.Redirect(w, r, "/same-host-download", http.StatusFound)
	}))
	defer server.Close()
	service := workflowLogTestService(t, server)
	client := service.client.(*http.Client)
	var originalRedirects atomic.Int32
	client.CheckRedirect = func(*http.Request, []*http.Request) error {
		originalRedirects.Add(1)
		return nil
	}
	got, err := service.JobLogs(githubTestTarget(), 10, 20)
	if err != nil || len(got.Steps) != 1 || got.Steps[0].Content != "only step" {
		t.Fatalf("result = %+v, error = %v", got, err)
	}
	if originalRedirects.Load() != 0 || client.CheckRedirect == nil || apiRequests.Load() != 2 || downloadRequests.Load() != 2 {
		t.Fatalf("original redirects = %d, API requests = %d, download requests = %d", originalRedirects.Load(), apiRequests.Load(), downloadRequests.Load())
	}
}

func TestWorkflowJobLogsMetadataRedirectDoesNotForwardToken(t *testing.T) {
	var leakedRequests atomic.Int32
	download := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		leakedRequests.Add(1)
		if r.Header.Get("Authorization") != "" {
			t.Error("metadata redirect leaked token")
		}
	}))
	defer download.Close()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, download.URL, http.StatusFound)
	}))
	defer server.Close()
	_, err := workflowLogTestService(t, server).JobLogs(githubTestTarget(), 10, 20)
	if err == nil || leakedRequests.Load() != 0 {
		t.Fatalf("error = %v, redirect requests = %d", err, leakedRequests.Load())
	}
}

func TestWorkflowJobLogsFolderMatching(t *testing.T) {
	cases := []struct {
		name    string
		jobName string
		entries []workflowLogTestEntry
		wantErr string
	}{
		{"sanitized slash", "Build / linux", []workflowLogTestEntry{{"Build _ linux/1_Set up job.txt", "selected"}, {"Other/1_Set up job.txt", "other"}}, ""},
		{"exact wins", "Build_linux", []workflowLogTestEntry{{"Build_linux/1_Set up job.txt", "selected"}, {"Build:linux/1_Set up job.txt", "other"}}, ""},
		{"ambiguous sanitization", "Build/linux", []workflowLogTestEntry{{"Build_linux/1_Set up job.txt", "one"}, {"Build:linux/1_Set up job.txt", "two"}}, "不唯一"},
		{"unrelated sole folder", "Build", []workflowLogTestEntry{{"Other/1_Set up job.txt", "wrong"}}, "尚无"},
		{"aggregate only", "Build", []workflowLogTestEntry{{"0_Build.txt", "whole job"}}, "尚无"},
		{"traversal alias", "Build", []workflowLogTestEntry{{"../Build/1_Set up job.txt", "wrong"}}, "尚无"},
		{"duplicate step", "Build", []workflowLogTestEntry{{"Build/1_Set up job.txt", "one"}, {"Build/1_Duplicate.txt", "two"}}, "多个文件"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			archive := workflowLogTestZIP(t, tc.entries...)
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if strings.HasSuffix(r.URL.Path, "/jobs/20") {
					fmt.Fprintf(w, `{"id":20,"run_id":10,"name":%q,"steps":[{"number":1}]}`, tc.jobName)
					return
				}
				w.Write(archive)
			}))
			defer server.Close()
			got, err := workflowLogTestService(t, server).JobLogs(githubTestTarget(), 10, 20)
			if tc.wantErr != "" {
				if err == nil || !strings.Contains(err.Error(), tc.wantErr) || len(got.Steps) != 0 {
					t.Fatalf("result = %+v, error = %v, want %q", got, err, tc.wantErr)
				}
				return
			}
			if err != nil || len(got.Steps) != 1 || got.Steps[0].Content != "selected" {
				t.Fatalf("result = %+v, error = %v", got, err)
			}
		})
	}
}

func TestWorkflowJobLogsUnavailableAndErrors(t *testing.T) {
	cases := []struct {
		name       string
		metadata   string
		metaStatus int
		logStatus  int
		body       string
		location   string
		wantErr    string
	}{
		{name: "expired", logStatus: 410, wantErr: "保留期"},
		{name: "not published", logStatus: 404, wantErr: "等待作业完成"},
		{name: "pending", logStatus: 202, wantErr: "暂不可用"},
		{name: "no content", logStatus: 204, wantErr: "暂不可用"},
		{name: "unauthorized", logStatus: 401, body: "bad token", wantErr: "401"},
		{name: "forbidden", logStatus: 403, body: "denied", wantErr: "403"},
		{name: "rate limited", logStatus: 429, wantErr: "429"},
		{name: "server error", logStatus: 500, wantErr: "500"},
		{name: "not a ZIP", body: "not a zip", wantErr: "有效的日志 ZIP"},
		{name: "metadata denied", metaStatus: 403, wantErr: "403"},
		{name: "invalid metadata", metadata: "{", wantErr: "解析"},
		{name: "metadata missing name", metadata: `{"id":20,"run_id":10}`, wantErr: "作业名称"},
		{name: "missing location", logStatus: 302, wantErr: "Location"},
		{name: "invalid redirect", logStatus: 302, location: "file:///tmp/log.zip", wantErr: "无效"},
		{name: "redirect loop", logStatus: 302, location: "/loop", wantErr: "重定向次数"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if strings.HasSuffix(r.URL.Path, "/jobs/20") {
					if tc.metaStatus != 0 {
						w.WriteHeader(tc.metaStatus)
					}
					if tc.metadata != "" {
						io.WriteString(w, tc.metadata)
					} else {
						io.WriteString(w, `{"id":20,"run_id":10,"name":"Build","steps":[{"number":1}]}`)
					}
					return
				}
				if tc.location != "" {
					w.Header().Set("Location", tc.location)
				}
				if tc.logStatus != 0 {
					w.WriteHeader(tc.logStatus)
				}
				io.WriteString(w, tc.body)
			}))
			defer server.Close()
			got, err := workflowLogTestService(t, server).JobLogs(githubTestTarget(), 10, 20)
			if err == nil || !strings.Contains(err.Error(), tc.wantErr) || len(got.Steps) != 0 {
				t.Fatalf("result = %+v, error = %v, want %q", got, err, tc.wantErr)
			}
		})
	}
}

func TestWorkflowJobLogsLimits(t *testing.T) {
	// CreateRaw lets the declared uncompressed sizes exercise ZIP bomb guards
	// without allocating or inflating large fixture data.
	declaredZIP := func(t *testing.T, sizes ...uint64) []byte {
		t.Helper()
		var buffer bytes.Buffer
		writer := zip.NewWriter(&buffer)
		for i, size := range sizes {
			_, err := writer.CreateRaw(&zip.FileHeader{Name: fmt.Sprintf("Build/%d_step.txt", i+1), Method: zip.Store, UncompressedSize64: size})
			if err != nil {
				t.Fatal(err)
			}
		}
		if err := writer.Close(); err != nil {
			t.Fatal(err)
		}
		return buffer.Bytes()
	}
	cases := []struct {
		name    string
		archive []byte
		length  bool
		stream  bool
		wantErr string
	}{
		{name: "declared download size", length: true, wantErr: "下载上限"},
		{name: "streamed download size", stream: true, wantErr: "下载上限"},
		{name: "entry inflation", archive: declaredZIP(t, workflowLogsEntryLimit+1), wantErr: "单文件"},
		{name: "entry count", archive: declaredZIP(t, make([]uint64, workflowLogsEntryCount+1)...), wantErr: "文件数"},
		{name: "total inflation", archive: declaredZIP(t, workflowLogsEntryLimit, workflowLogsEntryLimit, workflowLogsEntryLimit, workflowLogsEntryLimit, workflowLogsEntryLimit, workflowLogsEntryLimit, workflowLogsEntryLimit, workflowLogsEntryLimit, 1), wantErr: "总计"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if strings.HasSuffix(r.URL.Path, "/jobs/20") {
					io.WriteString(w, `{"id":20,"run_id":10,"name":"Build","steps":[{"number":1}]}`)
					return
				}
				if tc.length {
					w.Header().Set("Content-Length", fmt.Sprint(workflowLogsArchiveLimit+1))
					w.WriteHeader(http.StatusOK)
					return
				}
				if tc.stream {
					w.(http.Flusher).Flush() // Force chunked encoding; no Content-Length.
					chunk := make([]byte, 64<<10)
					for remaining := workflowLogsArchiveLimit + 1; remaining > 0; {
						count := min(remaining, len(chunk))
						if _, err := w.Write(chunk[:count]); err != nil {
							return
						}
						remaining -= count
					}
					return
				}
				w.Write(tc.archive)
			}))
			defer server.Close()
			got, err := workflowLogTestService(t, server).JobLogs(githubTestTarget(), 10, 20)
			if err == nil || !strings.Contains(err.Error(), tc.wantErr) || len(got.Steps) != 0 {
				t.Fatalf("result = %+v, error = %v, want %q", got, err, tc.wantErr)
			}
		})
	}
}

func TestWorkflowJobLogsRejectsHTTPSDowngrade(t *testing.T) {
	var downloads atomic.Int32
	download := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { downloads.Add(1) }))
	defer download.Close()
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/jobs/20") {
			io.WriteString(w, `{"id":20,"run_id":10,"name":"Build","steps":[{"number":1}]}`)
			return
		}
		http.Redirect(w, r, download.URL, http.StatusFound)
	}))
	defer server.Close()
	_, err := workflowLogTestService(t, server).JobLogs(githubTestTarget(), 10, 20)
	if err == nil || !strings.Contains(err.Error(), "降级") || downloads.Load() != 0 {
		t.Fatalf("error = %v, downloads = %d", err, downloads.Load())
	}
}

func TestWorkflowJobLogsCorruptZIPReturnsNoPartialLogs(t *testing.T) {
	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	for _, entry := range []workflowLogTestEntry{{"Build/1_Setup.txt", "good step"}, {"Build/2_Build.txt", "corrupt this payload"}} {
		file, err := writer.CreateHeader(&zip.FileHeader{Name: entry.name, Method: zip.Store})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := io.WriteString(file, entry.content); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	archive := buffer.Bytes()
	index := bytes.Index(archive, []byte("corrupt this payload"))
	if index < 0 {
		t.Fatal("fixture payload missing")
	}
	archive[index] ^= 1 // Keep the stored CRC unchanged.
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/jobs/20") {
			io.WriteString(w, `{"id":20,"run_id":10,"name":"Build","steps":[{"number":1},{"number":2}]}`)
			return
		}
		w.Write(archive)
	}))
	defer server.Close()
	got, err := workflowLogTestService(t, server).JobLogs(githubTestTarget(), 10, 20)
	if err == nil || !strings.Contains(err.Error(), "checksum") || len(got.Steps) != 0 {
		t.Fatalf("result = %+v, error = %v", got, err)
	}
}

type workflowLogOpaqueClient struct{ httpDoer }

func TestWorkflowJobLogsOpaqueClientFailsBeforeSendingToken(t *testing.T) {
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { requests.Add(1) }))
	defer server.Close()
	service := workflowLogTestService(t, server)
	service.client = workflowLogOpaqueClient{service.client}
	_, err := service.JobLogs(githubTestTarget(), 10, 20)
	if err == nil || !strings.Contains(err.Error(), "*http.Client") || requests.Load() != 0 {
		t.Fatalf("error = %v, requests = %d", err, requests.Load())
	}
}

func TestWorkflowJobLogsRejectsInvalidInputsBeforeNetwork(t *testing.T) {
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { requests.Add(1) }))
	defer server.Close()
	service := workflowLogTestService(t, server)
	for _, ids := range [][2]int64{{0, 20}, {10, 0}, {-1, 20}} {
		if _, err := service.JobLogs(githubTestTarget(), ids[0], ids[1]); err == nil {
			t.Errorf("IDs %v accepted", ids)
		}
	}
	target := githubTestTarget()
	target.Platform = "gitee"
	if _, err := service.JobLogs(target, 10, 20); err == nil {
		t.Error("unsupported platform accepted")
	}
	if requests.Load() != 0 {
		t.Fatalf("requests = %d", requests.Load())
	}
}
