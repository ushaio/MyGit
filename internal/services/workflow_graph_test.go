package services

import (
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
)

func TestWorkflowGraphParsesDeclaredDependencies(t *testing.T) {
	graph, err := parseWorkflowGraph([]byte(`name: CI
on: push
jobs:
  lint:
    runs-on: ubuntu-latest
  build:
    name: Build (${{ matrix.os }})
    needs: lint
    strategy:
      matrix:
        os: [ubuntu-latest, windows-latest]
  publish:
    name: Publish release
    needs: [lint, build]
  reusable:
    needs:
      - publish
    uses: another/repo/.github/workflows/release.yml@main
  independent:
    name: ''
    needs: []
`))
	if err != nil {
		t.Fatal(err)
	}
	want := WorkflowGraph{Nodes: []WorkflowGraphNode{
		{ID: "lint", Name: "lint", Needs: []string{}},
		{ID: "build", Name: "Build (${{ matrix.os }})", Needs: []string{"lint"}},
		{ID: "publish", Name: "Publish release", Needs: []string{"lint", "build"}},
		{ID: "reusable", Name: "reusable", Needs: []string{"publish"}},
		{ID: "independent", Name: "independent", Needs: []string{}},
	}}
	if !reflect.DeepEqual(graph, want) {
		t.Fatalf("graph = %#v, want %#v", graph, want)
	}
}

func TestWorkflowGraphNoDependencies(t *testing.T) {
	for _, sample := range []string{
		"name: CI\non: push\n",
		"jobs: {}\n",
	} {
		graph, err := parseWorkflowGraph([]byte(sample))
		if err != nil || graph.Nodes == nil || len(graph.Nodes) != 0 {
			t.Fatalf("parseWorkflowGraph(%q) = %#v, %v", sample, graph, err)
		}
	}
	// Job execution order does not create dependencies in the source graph.
	graph, err := parseWorkflowGraph([]byte("jobs:\n  first: {}\n  second: {}\n"))
	if err != nil {
		t.Fatal(err)
	}
	for _, node := range graph.Nodes {
		if node.Needs == nil || len(node.Needs) != 0 {
			t.Fatalf("job without needs acquired dependencies: %#v", node)
		}
	}
}

func TestWorkflowGraphRejectsInvalidYAML(t *testing.T) {
	cases := map[string]string{
		"syntax":          "jobs: [",
		"empty":           "",
		"root sequence":   "- build\n",
		"jobs sequence":   "jobs: [build]\n",
		"job scalar":      "jobs:\n  build: invalid\n",
		"duplicate job":   "jobs:\n  build: {}\n  build: {}\n",
		"duplicate jobs":  "jobs: {}\njobs: {}\n",
		"duplicate needs": "jobs:\n  build:\n    needs: lint\n    needs: test\n",
		"name mapping":    "jobs:\n  build:\n    name: {}\n",
		"needs mapping":   "jobs:\n  build:\n    needs: {lint: true}\n",
		"needs nested":    "jobs:\n  build:\n    needs: [[lint]]\n",
		"needs empty":     "jobs:\n  build:\n    needs: ''\n",
		"needs null":      "jobs:\n  build:\n    needs: null\n",
		"needs nonstring": "jobs:\n  build:\n    needs: [true]\n",
	}
	for name, sample := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := parseWorkflowGraph([]byte(sample)); err == nil {
				t.Fatalf("expected invalid YAML error for %q", sample)
			}
		})
	}
}

func TestWorkflowGraphReadsRunFileAtCommit(t *testing.T) {
	const sha = "acb5820ced9479c074f688cc328bf03f341a511d"
	for _, workflowPath := range []string{".github/workflows/ci.yml", ".github/workflows/构建 1.yaml"} {
		t.Run(workflowPath, func(t *testing.T) {
			var requests []string
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				requests = append(requests, r.URL.Path)
				if r.Method != http.MethodGet || r.Header.Get("Authorization") != "Bearer ghp_graph" {
					t.Errorf("request method/auth = %q/%q", r.Method, r.Header.Get("Authorization"))
				}
				switch r.URL.Path {
				case "/repos/owner/repo/actions/runs/42":
					if r.URL.RawQuery != "" {
						t.Errorf("run query = %q", r.URL.RawQuery)
					}
					json.NewEncoder(w).Encode(map[string]string{
						"path": workflowPath, "head_sha": sha, "head_branch": "changed-branch",
					})
				case "/repos/owner/repo/contents/" + workflowPath:
					if r.URL.Query().Get("ref") != sha || len(r.URL.Query()) != 1 {
						t.Errorf("contents query = %q, want run's exact head_sha", r.URL.RawQuery)
					}
					content := base64.StdEncoding.EncodeToString([]byte("jobs:\n  lint: {}\n  build:\n    needs: lint\n"))
					content = content[:10] + "\n" + content[10:]
					json.NewEncoder(w).Encode(map[string]string{"type": "file", "encoding": "base64", "content": content})
				default:
					t.Errorf("unexpected request: %s", r.URL)
					w.WriteHeader(http.StatusNotFound)
				}
			}))
			defer server.Close()
			creds := newFakeCredentialStore()
			creds.Set(workflowKeyringService, "github|github.com", "ghp_graph")
			service := newWorkflowService(server.Client(), creds, server.URL)
			graph, err := service.Graph(githubTestTarget(), 42)
			if err != nil {
				t.Fatal(err)
			}
			if len(requests) != 2 || len(graph.Nodes) != 2 || !reflect.DeepEqual(graph.Nodes[1].Needs, []string{"lint"}) {
				t.Fatalf("requests = %v, graph = %#v", requests, graph)
			}
		})
	}
}

func TestWorkflowGraphValidatesTargetAndRun(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("validation failure must not send a request")
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer server.Close()
	service := newTestService(t, server)
	for _, runID := range []int64{0, -1} {
		if _, err := service.Graph(githubTestTarget(), runID); err == nil {
			t.Fatalf("run %d should fail", runID)
		}
	}
	for _, target := range []WorkflowTarget{{Platform: "gitee"}, {Platform: "github", Repo: "repo"}} {
		if _, err := service.Graph(target, 42); err == nil {
			t.Fatalf("target %#v should fail", target)
		}
	}
}

func TestWorkflowGraphRejectsUncertainPaths(t *testing.T) {
	for _, workflowPath := range []string{
		"", "ci.yml", "/.github/workflows/ci.yml", "../.github/workflows/ci.yml",
		".github/workflows/../ci.yml", ".github/workflows/nested/ci.yml",
		".github/workflows/ci.yml?ref=main", ".github/workflows/ci.yml#fragment",
		".github/workflows/%2e%2e.yml", ".github/workflows/ci\\name.yml",
		".github/workflows/ci\n.yml", ".github/workflows/ci.txt",
		"owner/repo/.github/workflows/reuse.yml@main", ".github/workflows/ci.yml@refs/heads/main",
		"https://github.com/owner/repo/.github/workflows/ci.yml",
	} {
		t.Run(workflowPath, func(t *testing.T) {
			requests := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				requests++
				json.NewEncoder(w).Encode(map[string]string{"path": workflowPath, "head_sha": "abc123"})
			}))
			defer server.Close()
			if _, err := newTestService(t, server).Graph(githubTestTarget(), 42); err == nil {
				t.Fatalf("path %q should fail", workflowPath)
			}
			if requests != 1 {
				t.Fatalf("invalid path must not trigger contents request, got %d requests", requests)
			}
		})
	}
}

func TestWorkflowGraphAPIFailures(t *testing.T) {
	const run = `{"path":".github/workflows/ci.yml","head_sha":"abc123"}`
	cases := []struct {
		name       string
		runStatus  int
		runBody    string
		fileStatus int
		fileBody   string
		want       []string
	}{
		{"run forbidden", 403, `{"message":"run denied"}`, 0, "", []string{"运行 42", "403", "run denied"}},
		{"run missing", 404, `{"message":"not found"}`, 0, "", []string{"运行 42", "404"}},
		{"run invalid JSON", 200, "{", 0, "", []string{"运行 42", "解析"}},
		{"missing commit", 200, `{"path":".github/workflows/ci.yml"}`, 0, "", []string{"head_sha"}},
		{"contents missing", 200, run, 404, `{"message":"file missing"}`, []string{"ci.yml", "abc123", "404", "file missing"}},
		{"contents rate limit", 200, run, 429, `{"message":"slow down"}`, []string{"ci.yml", "429"}},
		{"contents invalid JSON", 200, run, 200, "{", []string{"ci.yml", "解析"}},
		{"contents directory", 200, run, 200, `{"type":"dir"}`, []string{"ci.yml", "不是文件"}},
		{"unsupported encoding", 200, run, 200, `{"encoding":"none","content":""}`, []string{"ci.yml", "编码"}},
		{"bad base64", 200, run, 200, `{"encoding":"base64","content":"!"}`, []string{"ci.yml", "解码"}},
		{"bad YAML", 200, run, 200, `{"encoding":"base64","content":"am9iczogWw=="}`, []string{"ci.yml", "abc123", "YAML"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/repos/owner/repo/actions/runs/42" {
					w.WriteHeader(tc.runStatus)
					io.WriteString(w, tc.runBody)
					return
				}
				if tc.fileStatus == 0 {
					t.Error("contents must not be requested after invalid run metadata")
					w.WriteHeader(http.StatusInternalServerError)
					return
				}
				w.WriteHeader(tc.fileStatus)
				io.WriteString(w, tc.fileBody)
			}))
			defer server.Close()
			_, err := newTestService(t, server).Graph(githubTestTarget(), 42)
			if err == nil {
				t.Fatal("expected graph failure")
			}
			for _, want := range tc.want {
				if !strings.Contains(err.Error(), want) {
					t.Errorf("error = %q, missing %q", err, want)
				}
			}
		})
	}
}

func TestWorkflowGraphFailureDoesNotAffectJobs(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/repos/owner/repo/actions/runs/42/jobs" {
			io.WriteString(w, `{"total_count":1,"jobs":[{"id":100,"name":"build","steps":[]}]}`)
			return
		}
		w.WriteHeader(http.StatusForbidden)
		io.WriteString(w, `{"message":"source access denied"}`)
	}))
	defer server.Close()
	service := newTestService(t, server)
	if _, err := service.Graph(githubTestTarget(), 42); err == nil {
		t.Fatal("expected graph error")
	}
	jobs, err := service.Jobs(githubTestTarget(), 42)
	if err != nil || len(jobs.Jobs) != 1 || jobs.Jobs[0].Name != "build" {
		t.Fatalf("Jobs after Graph failure = %#v, %v", jobs, err)
	}
}
