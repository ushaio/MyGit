package services

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"mygit-wails3/internal/workspace"
)

func TestModelsListsTheCatalogueAndSendsTheKey(t *testing.T) {
	var path, auth, accept string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path, auth, accept = r.URL.Path, r.Header.Get("Authorization"), r.Header.Get("Accept")
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"data":[{"id":"gpt-4o","owned_by":"openai"},{"id":"deepseek-chat","owned_by":"deepseek"},{"id":"gpt-4o"}]}`))
	}))
	defer server.Close()
	models, err := testAI(t).Models(server.URL+"/v1/", " sk-test ")
	if err != nil {
		t.Fatal(err)
	}
	if path != "/v1/models" {
		t.Fatalf("path: %s", path)
	}
	if auth != "Bearer sk-test" {
		t.Fatalf("authorization: %q", auth)
	}
	if accept != "application/json" {
		t.Fatalf("accept: %q", accept)
	}
	if len(models) != 2 || models[0].ID != "deepseek-chat" || models[1].ID != "gpt-4o" || models[1].Owner != "openai" {
		t.Fatalf("models: %+v", models)
	}
}

func TestModelsAcceptsTheOllamaShapeAndKeepsTheFullRoute(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/models" {
			t.Fatalf("path: %s", r.URL.Path)
		}
		if r.Header.Get("Authorization") != "" {
			t.Fatalf("an empty key sent an authorization header")
		}
		w.Write([]byte(`{"models":[{"name":"llama3:8b"},{"model":"qwen2.5-coder"}]}`))
	}))
	defer server.Close()
	models, err := testAI(t).Models(server.URL+"/v1/models", "")
	if err != nil {
		t.Fatal(err)
	}
	if len(models) != 2 || models[0].ID != "llama3:8b" || models[1].ID != "qwen2.5-coder" {
		t.Fatalf("models: %+v", models)
	}
}

func TestModelsReportsARejectedRequest(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, `{"error":{"message":"invalid api key"}}`, http.StatusUnauthorized)
	}))
	defer server.Close()
	_, err := testAI(t).Models(server.URL, "sk-wrong")
	if err == nil || !strings.Contains(err.Error(), "401") || !strings.Contains(err.Error(), "invalid api key") {
		t.Fatalf("error: %v", err)
	}
}

func TestModelsRejectsAnEmptyOrNonHTTPAddress(t *testing.T) {
	for _, address := range []string{"", "   ", "api.example.com", "file:///etc/passwd", "ftp://example.com/v1"} {
		if _, err := testAI(t).Models(address, ""); err == nil {
			t.Fatalf("address %q was accepted", address)
		}
	}
}

func TestModelsExplainsANonJSONReply(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("<html>not an api</html>"))
	}))
	defer server.Close()
	_, err := testAI(t).Models(server.URL, "")
	if err == nil || !strings.Contains(err.Error(), "OpenAI-compatible") {
		t.Fatalf("error: %v", err)
	}
}

func testAI(t *testing.T) *AIService {
	t.Helper()
	store, err := workspace.NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	return NewAIService(store)
}

// aiRepo is a repository where nothing is committed yet, which is exactly the
// state a first commit is written in.
func aiRepo(t *testing.T) string {
	t.Helper()
	path := t.TempDir()
	testGit(t, path, "init", "-q", "-b", "main")
	testGit(t, path, "config", "user.name", "Test")
	testGit(t, path, "config", "user.email", "test@example.com")
	return path
}

type chatRequest struct {
	Model       string `json:"model"`
	Temperature float32
	Messages    []chatMessage
}

func TestCommitMessageSendsTheStagedDiffWithTheSavedPrompt(t *testing.T) {
	path := aiRepo(t)
	write(t, path, "b.txt", "hello\n")
	testGit(t, path, "add", "b.txt")
	var endpoint, auth string
	var request chatRequest
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		endpoint, auth = r.URL.Path, r.Header.Get("Authorization")
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Fatalf("decode: %v", err)
		}
		reply, err := json.Marshal(map[string]any{"choices": []any{map[string]any{
			"message": map[string]any{"role": "assistant", "content": "```\nfeat: add b.txt\n```"},
		}}})
		if err != nil {
			t.Fatal(err)
		}
		w.Write(reply)
	}))
	defer server.Close()
	store, err := workspace.NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.SetPreferences(workspace.Preferences{
		Theme: "light", Language: "en", AIURL: server.URL + "/v1/", AIKey: " sk-key ",
		AIModel: "deepseek-chat", AICommitPrompt: "  Write short English messages.  ",
	}); err != nil {
		t.Fatal(err)
	}
	message, err := NewAIService(store).CommitMessage(path)
	if err != nil {
		t.Fatal(err)
	}
	if message != "feat: add b.txt" {
		t.Fatalf("message: %q", message)
	}
	if endpoint != "/v1/chat/completions" || auth != "Bearer sk-key" {
		t.Fatalf("endpoint %q auth %q", endpoint, auth)
	}
	if request.Model != "deepseek-chat" || request.Temperature != 0.2 {
		t.Fatalf("request: %+v", request)
	}
	if len(request.Messages) != 2 || request.Messages[0].Role != "system" || request.Messages[0].Content != "Write short English messages." {
		t.Fatalf("system message: %+v", request.Messages)
	}
	input := request.Messages[1].Content
	for _, want := range []string{"b.txt", "+hello", "Staged files:"} {
		if !strings.Contains(input, want) {
			t.Fatalf("staged diff lacks %q: %s", want, input)
		}
	}
}

func TestCommitMessageFallsBackToTheBuiltInPrompt(t *testing.T) {
	path := aiRepo(t)
	write(t, path, "c.txt", "c\n")
	testGit(t, path, "add", "c.txt")
	var request chatRequest
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Fatalf("decode: %v", err)
		}
		w.Write([]byte(`{"choices":[{"message":{"content":"chore: add c.txt"}}]}`))
	}))
	defer server.Close()
	store, err := workspace.NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.SetPreferences(workspace.Preferences{
		Theme: "light", Language: "en", AIURL: server.URL, AIModel: "gpt-4o-mini",
	}); err != nil {
		t.Fatal(err)
	}
	service := NewAIService(store)
	if _, err := service.CommitMessage(path); err != nil {
		t.Fatal(err)
	}
	if len(request.Messages) == 0 || request.Messages[0].Content != service.DefaultCommitPrompt() {
		t.Fatalf("system message: %+v", request.Messages)
	}
}

func TestCommitMessageRejectsAMissingModelOrAnEmptyIndex(t *testing.T) {
	path := aiRepo(t)
	store, err := workspace.NewStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.SetPreferences(workspace.Preferences{
		Theme: "light", Language: "en", AIURL: "https://api.example.com/v1",
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := NewAIService(store).CommitMessage(path); err == nil || !strings.Contains(err.Error(), "choose the model") {
		t.Fatalf("missing model error: %v", err)
	}
	if _, err := store.SetPreferences(workspace.Preferences{
		Theme: "light", Language: "en", AIURL: "https://api.example.com/v1", AIModel: "gpt-4o-mini",
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := NewAIService(store).CommitMessage(path); err == nil || !strings.Contains(err.Error(), "nothing is staged") {
		t.Fatalf("empty index error: %v", err)
	}
}

func TestCommitMessageReportsARejectedOrEmptyReply(t *testing.T) {
	path := aiRepo(t)
	write(t, path, "d.txt", "d\n")
	testGit(t, path, "add", "d.txt")
	rejected := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, `{"error":{"message":"model not found"}}`, http.StatusNotFound)
	}))
	defer rejected.Close()
	empty := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"choices":[{"message":{"content":"   "}}]}`))
	}))
	defer empty.Close()
	for _, test := range []struct {
		url  string
		want string
	}{
		{rejected.URL, "model not found"},
		{empty.URL, "empty commit message"},
	} {
		store, err := workspace.NewStore(t.TempDir())
		if err != nil {
			t.Fatal(err)
		}
		if _, err := store.SetPreferences(workspace.Preferences{
			Theme: "light", Language: "en", AIURL: test.url, AIModel: "gpt-4o-mini",
		}); err != nil {
			t.Fatal(err)
		}
		if _, err := NewAIService(store).CommitMessage(path); err == nil || !strings.Contains(err.Error(), test.want) {
			t.Fatalf("error for %s: %v", test.url, err)
		}
	}
}

func TestChatEndpointAcceptsTheRouteTheUserPasted(t *testing.T) {
	for address, want := range map[string]string{
		"https://api.example.com/v1":                  "https://api.example.com/v1/chat/completions",
		"https://api.example.com/v1/":                 "https://api.example.com/v1/chat/completions",
		"https://api.example.com/v1/models":           "https://api.example.com/v1/chat/completions",
		"https://api.example.com/v1/chat/completions": "https://api.example.com/v1/chat/completions",
	} {
		got, err := chatEndpoint(address)
		if err != nil || got != want {
			t.Fatalf("%s: %q %v", address, got, err)
		}
	}
}

func TestCleanCommitMessageDropsWrapping(t *testing.T) {
	for reply, want := range map[string]string{
		"```\nfeat: add a file\n```":  "feat: add a file",
		"```text\nfix: crash\n```":    "fix: crash",
		"\"chore: tidy\"":             "chore: tidy",
		"  refactor: move helper  \n": "refactor: move helper",
	} {
		got, err := cleanCommitMessage(reply)
		if err != nil || got != want {
			t.Fatalf("%q → %q (%v)", reply, got, err)
		}
	}
}
