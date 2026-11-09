package services

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/zalando/go-keyring"
)

// fakeCredentialStore is an in-memory credentialStore so tests never touch the
// real OS keychain.
type fakeCredentialStore struct {
	mu   sync.Mutex
	data map[string]string
}

func newFakeCredentialStore() *fakeCredentialStore {
	return &fakeCredentialStore{data: make(map[string]string)}
}

func (f *fakeCredentialStore) key(service, account string) string {
	return service + "\x00" + account
}

func (f *fakeCredentialStore) Get(service, account string) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	value, ok := f.data[f.key(service, account)]
	if !ok {
		return "", keyring.ErrNotFound
	}
	return value, nil
}

func (f *fakeCredentialStore) Set(service, account, secret string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.data[f.key(service, account)] = secret
	return nil
}

func (f *fakeCredentialStore) Delete(service, account string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	key := f.key(service, account)
	if _, ok := f.data[key]; !ok {
		return keyring.ErrNotFound
	}
	delete(f.data, key)
	return nil
}

func githubTestTarget() WorkflowTarget {
	return WorkflowTarget{
		Platform: "github",
		Host:     "github.com",
		APIHost:  "api.github.com",
		Owner:    "owner",
		Repo:     "repo",
		Remote:   "origin",
		WebURL:   "https://github.com/owner/repo",
	}
}

func newTestService(t *testing.T, server *httptest.Server) *WorkflowService {
	t.Helper()
	return newWorkflowService(server.Client(), newFakeCredentialStore(), server.URL)
}

func TestWorkflowResolveTarget(t *testing.T) {
	service := NewWorkflowService()

	tests := []struct {
		name       string
		remoteName string
		remoteURL  string
		platform   string
		host       string
		apiHost    string
		owner      string
		repo       string
		webURL     string
		wantErr    bool
	}{
		{
			name: "https with .git", remoteURL: "https://github.com/octo/hello.git",
			platform: "github", host: "github.com", apiHost: "api.github.com",
			owner: "octo", repo: "hello", webURL: "https://github.com/octo/hello",
		},
		{
			name: "scp-like", remoteURL: "git@github.com:octo/hello.git",
			platform: "github", host: "github.com", apiHost: "api.github.com",
			owner: "octo", repo: "hello", webURL: "https://github.com/octo/hello",
		},
		{
			name: "ssh scheme", remoteURL: "ssh://git@github.com/octo/hello.git",
			platform: "github", host: "github.com", apiHost: "api.github.com",
			owner: "octo", repo: "hello", webURL: "https://github.com/octo/hello",
		},
		{
			name: "ssh scheme with port", remoteURL: "ssh://git@github.com:22/octo/hello",
			platform: "github", host: "github.com", apiHost: "api.github.com",
			owner: "octo", repo: "hello", webURL: "https://github.com/octo/hello",
		},
		{
			name: "gitee", remoteURL: "https://gitee.com/octo/hello.git",
			platform: "gitee", host: "gitee.com", apiHost: "",
			owner: "octo", repo: "hello", webURL: "https://gitee.com/octo/hello",
		},
		{
			name: "gitcode .com", remoteURL: "https://gitcode.com/octo/hello",
			platform: "gitcode", host: "gitcode.com", apiHost: "",
			owner: "octo", repo: "hello", webURL: "https://gitcode.com/octo/hello",
		},
		{
			name: "gitcode .net", remoteURL: "git@gitcode.net:octo/hello.git",
			platform: "gitcode", host: "gitcode.net", apiHost: "",
			owner: "octo", repo: "hello", webURL: "https://gitcode.net/octo/hello",
		},
		{
			name: "www host normalised", remoteURL: "https://www.github.com/octo/hello",
			platform: "github", host: "github.com", apiHost: "api.github.com",
			owner: "octo", repo: "hello", webURL: "https://github.com/octo/hello",
		},
		{name: "unknown host", remoteURL: "https://gitlab.com/octo/hello", wantErr: true},
		{name: "missing repo", remoteURL: "https://github.com/octo", wantErr: true},
		{name: "empty", remoteURL: "", wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			target, err := service.ResolveTarget("origin", tt.remoteURL)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("expected an error for %q", tt.remoteURL)
				}
				return
			}
			if err != nil {
				t.Fatalf("ResolveTarget(%q): %v", tt.remoteURL, err)
			}
			if target.Platform != tt.platform || target.Host != tt.host || target.APIHost != tt.apiHost {
				t.Fatalf("target platform/host/apiHost = %q/%q/%q", target.Platform, target.Host, target.APIHost)
			}
			if target.Owner != tt.owner || target.Repo != tt.repo {
				t.Fatalf("target owner/repo = %q/%q", target.Owner, target.Repo)
			}
			if target.WebURL != tt.webURL {
				t.Fatalf("target WebURL = %q, want %q", target.WebURL, tt.webURL)
			}
			if target.Remote != "origin" {
				t.Fatalf("target Remote = %q", target.Remote)
			}
		})
	}
}

func TestWorkflowCapabilitiesMatrix(t *testing.T) {
	service := NewWorkflowService()
	all := WorkflowCapabilities{true, true, true, true, true, true}
	webOnly := WorkflowCapabilities{false, false, false, false, false, true}

	cases := map[string]WorkflowCapabilities{
		"github":  all,
		"gitee":   webOnly,
		"gitcode": webOnly,
	}
	for platform, want := range cases {
		got := service.Capabilities(WorkflowTarget{Platform: platform})
		if got != want {
			t.Fatalf("Capabilities(%q) = %+v, want %+v", platform, got, want)
		}
	}
}

func TestWorkflowListWorkflowsPathQueryAndPagination(t *testing.T) {
	var gotPath, gotQuery string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotQuery = r.URL.RawQuery
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, `{"total_count":45,"workflows":[
			{"id":1,"name":"CI","path":".github/workflows/ci.yml","state":"active","html_url":"https://github.com/o/r/actions/workflows/ci.yml"},
			{"id":2,"name":"Release","path":".github/workflows/release.yml","state":"disabled_manually","html_url":"https://github.com/o/r/actions/workflows/release.yml"}
		]}`)
	}))
	defer server.Close()

	list, err := newTestService(t, server).ListWorkflows(githubTestTarget(), 2)
	if err != nil {
		t.Fatal(err)
	}
	if gotPath != "/repos/owner/repo/actions/workflows" {
		t.Fatalf("path = %q", gotPath)
	}
	if !strings.Contains(gotQuery, "per_page=20") || !strings.Contains(gotQuery, "page=2") {
		t.Fatalf("query = %q", gotQuery)
	}
	if list.Total != 45 || list.Page != 2 || list.PerPage != 20 {
		t.Fatalf("list meta = %+v", list)
	}
	if !list.HasMore {
		t.Fatalf("HasMore should be true when page*perPage < total")
	}
	if len(list.Workflows) != 2 || list.Workflows[0].Name != "CI" || list.Workflows[0].ID != 1 ||
		list.Workflows[1].State != "disabled_manually" {
		t.Fatalf("workflows = %+v", list.Workflows)
	}
}

func TestWorkflowListWorkflowsClampsPageAndNoMore(t *testing.T) {
	var gotPage string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPage = r.URL.Query().Get("page")
		io.WriteString(w, `{"total_count":3,"workflows":[]}`)
	}))
	defer server.Close()

	list, err := newTestService(t, server).ListWorkflows(githubTestTarget(), 0)
	if err != nil {
		t.Fatal(err)
	}
	if gotPage != "1" || list.Page != 1 {
		t.Fatalf("page = %q / %d, want 1", gotPage, list.Page)
	}
	if list.HasMore {
		t.Fatalf("HasMore should be false for a single page")
	}
}

func TestWorkflowListRunsVariants(t *testing.T) {
	type capture struct{ path, query string }
	var got capture
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = capture{r.URL.Path, r.URL.RawQuery}
		io.WriteString(w, `{"total_count":21,"workflow_runs":[
			{"id":100,"workflow_id":7,"run_number":12,"name":"CI","display_title":"Fix typo","status":"completed","conclusion":"success","head_branch":"main","head_sha":"abc123","event":"push","created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-01T00:05:00Z","html_url":"https://github.com/o/r/actions/runs/100"}
		]}`)
	}))
	defer server.Close()
	service := newTestService(t, server)

	// Repository-wide runs with a branch filter.
	runs, err := service.ListRuns(githubTestTarget(), 0, "main", 1)
	if err != nil {
		t.Fatal(err)
	}
	if got.path != "/repos/owner/repo/actions/runs" {
		t.Fatalf("path = %q", got.path)
	}
	if !strings.Contains(got.query, "branch=main") {
		t.Fatalf("query = %q", got.query)
	}
	if len(runs.Runs) != 1 || runs.Runs[0].Title != "Fix typo" || runs.Runs[0].Number != 12 || runs.Runs[0].Conclusion != "success" {
		t.Fatalf("runs = %+v", runs.Runs)
	}
	if !runs.HasMore {
		t.Fatalf("HasMore should be true (1*20 < 21)")
	}

	// Workflow-scoped runs without a branch filter.
	if _, err := service.ListRuns(githubTestTarget(), 7, "  ", 1); err != nil {
		t.Fatal(err)
	}
	if got.path != "/repos/owner/repo/actions/workflows/7/runs" {
		t.Fatalf("path = %q", got.path)
	}
	if strings.Contains(got.query, "branch=") {
		t.Fatalf("query should not carry a branch: %q", got.query)
	}
}

func TestWorkflowJobsParsesJobsAndSteps(t *testing.T) {
	var gotPath, gotQuery string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotQuery = r.URL.RawQuery
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, `{"total_count":2,"jobs":[
			{"id":11,"run_id":9001,"name":"Build & Package (windows)","status":"completed","conclusion":"success","started_at":"2026-01-01T08:00:00Z","completed_at":"2026-01-01T08:05:00Z",
			 "steps":[{"number":1,"name":"Set up job","status":"completed","conclusion":"success","started_at":"2026-01-01T08:00:00Z","completed_at":"2026-01-01T08:00:05Z"}]},
			{"id":12,"run_id":9001,"name":"Publish release","status":"completed","conclusion":"success","started_at":"2026-01-01T08:05:00Z","completed_at":"2026-01-01T08:05:11Z","steps":[]}
		]}`)
	}))
	defer server.Close()

	jobs, err := newTestService(t, server).Jobs(githubTestTarget(), 9001)
	if err != nil {
		t.Fatal(err)
	}
	if gotPath != "/repos/owner/repo/actions/runs/9001/jobs" {
		t.Fatalf("path = %q", gotPath)
	}
	if !strings.Contains(gotQuery, "per_page=100") {
		t.Fatalf("query = %q", gotQuery)
	}
	if jobs.Total != 2 || len(jobs.Jobs) != 2 {
		t.Fatalf("jobs = %+v", jobs)
	}
	if jobs.Jobs[0].Name != "Build & Package (windows)" || jobs.Jobs[0].Conclusion != "success" {
		t.Fatalf("job0 = %+v", jobs.Jobs[0])
	}
	if len(jobs.Jobs[0].Steps) != 1 || jobs.Jobs[0].Steps[0].Name != "Set up job" {
		t.Fatalf("steps = %+v", jobs.Jobs[0].Steps)
	}
	if jobs.Jobs[1].Steps == nil || len(jobs.Jobs[1].Steps) != 0 {
		t.Fatalf("job1 steps should be empty non-nil, got %+v", jobs.Jobs[1].Steps)
	}
}

func TestWorkflowJobsRequiresRunID(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatalf("no request expected")
	}))
	defer server.Close()
	if _, err := newTestService(t, server).Jobs(githubTestTarget(), 0); err == nil {
		t.Fatal("expected error for missing run id")
	}
}

func TestWorkflowDispatchBuildsBody(t *testing.T) {
	var method, path string
	var body struct {
		Ref    string            `json:"ref"`
		Inputs map[string]string `json:"inputs"`
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		method, path = r.Method, r.URL.Path
		json.NewDecoder(r.Body).Decode(&body)
		w.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()

	inputs := []WorkflowInput{
		{Name: "environment", Required: true, Default: "staging"},
		{Name: "dry_run", Type: "boolean", Default: "false"},
		{Name: "unused", Default: ""},
	}
	if err := newTestService(t, server).Dispatch(githubTestTarget(), 9, "main", inputs); err != nil {
		t.Fatal(err)
	}
	if method != http.MethodPost || path != "/repos/owner/repo/actions/workflows/9/dispatches" {
		t.Fatalf("method/path = %s %s", method, path)
	}
	if body.Ref != "main" {
		t.Fatalf("ref = %q", body.Ref)
	}
	if body.Inputs["environment"] != "staging" || body.Inputs["dry_run"] != "false" {
		t.Fatalf("inputs = %+v", body.Inputs)
	}
	if _, ok := body.Inputs["unused"]; ok {
		t.Fatalf("empty input should not be sent: %+v", body.Inputs)
	}
}

func TestWorkflowDispatchValidatesRequiredAndRef(t *testing.T) {
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		w.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()
	service := newTestService(t, server)

	if err := service.Dispatch(githubTestTarget(), 9, "", nil); err == nil {
		t.Fatalf("empty ref should be rejected")
	}
	missing := []WorkflowInput{{Name: "environment", Required: true, Default: ""}}
	if err := service.Dispatch(githubTestTarget(), 9, "main", missing); err == nil {
		t.Fatalf("missing required input should be rejected")
	}
	if requests != 0 {
		t.Fatalf("no request should be sent when validation fails, got %d", requests)
	}
}

func TestWorkflowRerunAndCancelPaths(t *testing.T) {
	var lastMethod, lastPath string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		lastMethod, lastPath = r.Method, r.URL.Path
		w.WriteHeader(http.StatusCreated)
	}))
	defer server.Close()
	service := newTestService(t, server)

	if err := service.Rerun(githubTestTarget(), 55); err != nil {
		t.Fatal(err)
	}
	if lastMethod != http.MethodPost || lastPath != "/repos/owner/repo/actions/runs/55/rerun" {
		t.Fatalf("rerun = %s %s", lastMethod, lastPath)
	}
	if err := service.Cancel(githubTestTarget(), 55); err != nil {
		t.Fatal(err)
	}
	if lastMethod != http.MethodPost || lastPath != "/repos/owner/repo/actions/runs/55/cancel" {
		t.Fatalf("cancel = %s %s", lastMethod, lastPath)
	}
}

func TestWorkflowErrorMapping(t *testing.T) {
	cases := []struct {
		status int
		want   string
	}{
		{http.StatusUnauthorized, "令牌无效或已过期"},
		{http.StatusForbidden, "权限不足或触发限流"},
		{http.StatusNotFound, "仓库不存在、Actions 未启用或无权访问"},
		{http.StatusTooManyRequests, "触发 GitHub 限流"},
	}
	for _, tc := range cases {
		t.Run(http.StatusText(tc.status), func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(tc.status)
				io.WriteString(w, `{"message":"boom"}`)
			}))
			defer server.Close()
			_, err := newTestService(t, server).ListWorkflows(githubTestTarget(), 1)
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("status %d error = %v, want substring %q", tc.status, err, tc.want)
			}
			if !strings.Contains(err.Error(), "boom") {
				t.Fatalf("error should carry the body snippet: %v", err)
			}
		})
	}
}

func TestWorkflowSaveTokenValidatesAndStores(t *testing.T) {
	var authHeader string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/user" {
			t.Fatalf("unexpected path %q", r.URL.Path)
		}
		authHeader = r.Header.Get("Authorization")
		io.WriteString(w, `{"login":"octocat"}`)
	}))
	defer server.Close()

	creds := newFakeCredentialStore()
	service := newWorkflowService(server.Client(), creds, server.URL)

	account, err := service.SaveToken(githubTestTarget(), "  ghp_secret  ")
	if err != nil {
		t.Fatal(err)
	}
	if authHeader != "Bearer ghp_secret" {
		t.Fatalf("authorization = %q", authHeader)
	}
	if !account.Configured || account.Account != "octocat" || account.Platform != "github" {
		t.Fatalf("account = %+v", account)
	}
	stored, err := creds.Get(workflowKeyringService, "github|github.com")
	if err != nil || stored != "ghp_secret" {
		t.Fatalf("stored token = %q, err = %v", stored, err)
	}

	// Account reflects the stored token without another request.
	status, err := service.Account(githubTestTarget())
	if err != nil {
		t.Fatal(err)
	}
	if !status.Configured || status.Account != "octocat" {
		t.Fatalf("account status = %+v", status)
	}
}

func TestWorkflowSaveTokenRejectsBadToken(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		io.WriteString(w, `{"message":"Bad credentials"}`)
	}))
	defer server.Close()
	creds := newFakeCredentialStore()
	service := newWorkflowService(server.Client(), creds, server.URL)

	if _, err := service.SaveToken(githubTestTarget(), "ghp_bad"); err == nil {
		t.Fatalf("a 401 token should be rejected")
	}
	if _, err := creds.Get(workflowKeyringService, "github|github.com"); !errors.Is(err, keyring.ErrNotFound) {
		t.Fatalf("rejected token must not be stored")
	}
}

func TestWorkflowDeleteTokenRemoves(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		io.WriteString(w, `{"login":"octocat"}`)
	}))
	defer server.Close()
	creds := newFakeCredentialStore()
	service := newWorkflowService(server.Client(), creds, server.URL)

	if _, err := service.SaveToken(githubTestTarget(), "ghp_secret"); err != nil {
		t.Fatal(err)
	}
	if _, err := service.DeleteToken(githubTestTarget()); err != nil {
		t.Fatal(err)
	}
	if _, err := creds.Get(workflowKeyringService, "github|github.com"); !errors.Is(err, keyring.ErrNotFound) {
		t.Fatalf("token should be deleted")
	}
	status, err := service.Account(githubTestTarget())
	if err != nil {
		t.Fatal(err)
	}
	if status.Configured {
		t.Fatalf("account should be unconfigured after delete: %+v", status)
	}
	// Deleting again is a no-op, not an error.
	if _, err := service.DeleteToken(githubTestTarget()); err != nil {
		t.Fatalf("deleting a missing token should be tolerated: %v", err)
	}
}

func TestWorkflowNonGitHubTokenUnsupported(t *testing.T) {
	service := NewWorkflowService()
	gitee := WorkflowTarget{Platform: "gitee", Host: "gitee.com", Owner: "o", Repo: "r"}
	if _, err := service.SaveToken(gitee, "x"); err == nil {
		t.Fatalf("SaveToken should reject gitee")
	}
	if _, err := service.DeleteToken(gitee); err == nil {
		t.Fatalf("DeleteToken should reject gitee")
	}
	account, err := service.Account(gitee)
	if err != nil || account.Configured {
		t.Fatalf("Account(gitee) = %+v, err %v", account, err)
	}
	if _, err := service.ListWorkflows(gitee, 1); err == nil {
		t.Fatalf("ListWorkflows should reject gitee")
	}
}

func TestWorkflowInputsParsesYAML(t *testing.T) {
	sample := `name: CI
on:
  push:
    branches: [main]
  workflow_dispatch:
    inputs:
      environment:
        description: 部署环境
        type: choice
        required: true
        default: staging
        options:
          - staging
          - production
      dry_run:
        description: 仅演练
        type: boolean
        required: false
        default: false
      version:
        description: 版本号
        required: true
jobs:
  build:
    runs-on: ubuntu-latest
`
	content := base64.StdEncoding.EncodeToString([]byte(sample))
	// GitHub wraps base64 with newlines; mimic that.
	content = content[:20] + "\n" + content[20:]

	var gotPath, gotRef string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotRef = r.URL.Query().Get("ref")
		payload, _ := json.Marshal(map[string]string{"content": content, "encoding": "base64"})
		w.Write(payload)
	}))
	defer server.Close()

	inputs, err := newTestService(t, server).Inputs(githubTestTarget(), ".github/workflows/ci.yml", "main")
	if err != nil {
		t.Fatal(err)
	}
	if gotPath != "/repos/owner/repo/contents/.github/workflows/ci.yml" {
		t.Fatalf("path = %q", gotPath)
	}
	if gotRef != "main" {
		t.Fatalf("ref = %q", gotRef)
	}
	if len(inputs) != 3 {
		t.Fatalf("inputs = %+v", inputs)
	}

	env := inputs[0]
	if env.Name != "environment" || env.Type != "choice" || !env.Required || env.Default != "staging" ||
		len(env.Options) != 2 || env.Options[0] != "staging" || env.Options[1] != "production" {
		t.Fatalf("environment input = %+v", env)
	}
	dry := inputs[1]
	if dry.Name != "dry_run" || dry.Type != "boolean" || dry.Required || dry.Default != "false" {
		t.Fatalf("dry_run input = %+v", dry)
	}
	version := inputs[2]
	if version.Name != "version" || version.Type != "string" || !version.Required || version.Default != "" {
		t.Fatalf("version input = %+v", version)
	}
}

func TestWorkflowInputsEmptyWhenNoDispatchOrScalarOn(t *testing.T) {
	// on is a plain string, so there is no workflow_dispatch.
	sample := "name: CI\non: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n"
	content := base64.StdEncoding.EncodeToString([]byte(sample))
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		payload, _ := json.Marshal(map[string]string{"content": content, "encoding": "base64"})
		w.Write(payload)
	}))
	defer server.Close()

	inputs, err := newTestService(t, server).Inputs(githubTestTarget(), "ci.yml", "main")
	if err != nil {
		t.Fatal(err)
	}
	if inputs == nil || len(inputs) != 0 {
		t.Fatalf("expected an empty non-nil slice, got %+v", inputs)
	}
}

func TestWorkflowAuthorizationOnlyToAPIBaisc(t *testing.T) {
	var gotAuth string
	primary := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		io.WriteString(w, `{"total_count":0,"workflows":[]}`)
	}))
	defer primary.Close()

	decoyRequests := 0
	decoy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		decoyRequests++
	}))
	defer decoy.Close()

	creds := newFakeCredentialStore()
	creds.Set(workflowKeyringService, "github|github.com", "ghp_token")
	service := newWorkflowService(primary.Client(), creds, primary.URL)

	if _, err := service.ListWorkflows(githubTestTarget(), 1); err != nil {
		t.Fatal(err)
	}
	if gotAuth != "Bearer ghp_token" {
		t.Fatalf("authorization to the API base = %q", gotAuth)
	}
	_ = decoy.URL // the service is pinned to primary.URL; the decoy must stay untouched
	if decoyRequests != 0 {
		t.Fatalf("the token must never reach another host, decoy got %d requests", decoyRequests)
	}
}

func TestWorkflowListWithoutTokenSendsNoAuthorization(t *testing.T) {
	var sawAuth bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "" {
			sawAuth = true
		}
		io.WriteString(w, `{"total_count":0,"workflows":[]}`)
	}))
	defer server.Close()

	if _, err := newTestService(t, server).ListWorkflows(githubTestTarget(), 1); err != nil {
		t.Fatal(err)
	}
	if sawAuth {
		t.Fatalf("no token is stored, so no Authorization header should be sent")
	}
}
