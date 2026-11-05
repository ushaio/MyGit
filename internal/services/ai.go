package services

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	"mygit-wails3/internal/gitrepo"
	"mygit-wails3/internal/workspace"
)

// AIService talks to the OpenAI-compatible endpoint configured in settings.
// It discovers models so the settings dialog can offer the endpoint's real
// catalogue, and writes commit messages from the staged change set.
type AIService struct {
	git   gitrepo.Git
	store *workspace.Store
}

// AIModel is one entry of a service's model catalogue.
type AIModel struct {
	ID    string
	Owner string
}

func NewAIService(store *workspace.Store) *AIService {
	return &AIService{git: gitrepo.Git{Env: gitEnv()}, store: store}
}

const (
	aiTimeout      = 20 * time.Second
	aiChatTimeout  = 2 * time.Minute
	aiBodyLimit    = 4 << 20
	aiChatBodySize = 16 << 20
)

// defaultCommitPrompt is what MyGit asks for when the user has not written a
// prompt of their own. It asks for English, which the settings dialog states;
// the prompt is user-editable, so another language is one edit away.
const defaultCommitPrompt = `You write commit messages for a Git repository.
The user message describes one staged change set: the staged file stat, the per-file statuses, and a unified diff.
Reply with a single commit message written in English, in the Conventional Commits style:
<type>(<scope>): <summary>
Use feat, fix, refactor, perf, docs, test, build, chore or style as the type, add a scope only when the affected area is obvious, and keep the summary an imperative sentence of at most 72 characters.
When the change needs explanation, add a blank line and then two to four bullet points that say what changed and why.
Reply with the message only: no code fences, no quotes, no preamble.`

// DefaultCommitPrompt returns the built-in prompt, so the settings dialog can
// show what an empty prompt field means.
func (s *AIService) DefaultCommitPrompt() string { return defaultCommitPrompt }

// Models lists the models advertised by the endpoint at its /models route.
func (s *AIService) Models(address, key string) ([]AIModel, error) {
	endpoint, err := modelsEndpoint(address)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), aiTimeout)
	defer cancel()
	body, err := s.get(ctx, endpoint, key, "the model list")
	if err != nil {
		return nil, err
	}
	return parseModels(body)
}

// CommitMessage writes a commit message for the staged changes of the
// repository at path, using the prompt and model saved in settings.
func (s *AIService) CommitMessage(path string) (string, error) {
	preferences := s.store.Snapshot().Preferences
	endpoint, err := chatEndpoint(preferences.AIURL)
	if err != nil {
		return "", err
	}
	model := strings.TrimSpace(preferences.AIModel)
	if model == "" {
		return "", errors.New("choose the model to use in Settings, AI")
	}
	diff, err := s.git.StagedDiff(path)
	if err != nil {
		return "", fmt.Errorf("could not read the staged changes: %w", err)
	}
	if strings.TrimSpace(diff) == "" {
		return "", errors.New("stage the changes to describe first; nothing is staged")
	}
	prompt := strings.TrimSpace(preferences.AICommitPrompt)
	if prompt == "" {
		prompt = defaultCommitPrompt
	}
	reply, err := s.chat(endpoint, preferences.AIKey, model, prompt, diff)
	if err != nil {
		return "", err
	}
	return cleanCommitMessage(reply)
}

// get fetches an OpenAI-compatible route and reports a readable error for a
// rejected request.
func (s *AIService) get(ctx context.Context, endpoint, key, what string) ([]byte, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, errors.New("the AI address is not a valid URL")
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("User-Agent", "MyGit")
	if key = strings.TrimSpace(key); key != "" {
		request.Header.Set("Authorization", "Bearer "+key)
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return nil, fmt.Errorf("could not reach the AI service: %w", err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, aiBodyLimit))
	if err != nil {
		return nil, fmt.Errorf("could not read the %s: %w", what, err)
	}
	if response.StatusCode < 200 || response.StatusCode > 299 {
		return nil, fmt.Errorf("the AI service refused the request (%s): %s", response.Status, snippet(body))
	}
	return body, nil
}

type chatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// chat posts one completion request and returns the assistant's text.
func (s *AIService) chat(endpoint, key, model, prompt, input string) (string, error) {
	payload, err := json.Marshal(struct {
		Model       string        `json:"model"`
		Messages    []chatMessage `json:"messages"`
		Temperature float32       `json:"temperature"`
		Stream      bool          `json:"stream"`
	}{
		Model:       model,
		Messages:    []chatMessage{{Role: "system", Content: prompt}, {Role: "user", Content: input}},
		Temperature: 0.2,
		Stream:      false,
	})
	if err != nil {
		return "", err
	}
	ctx, cancel := context.WithTimeout(context.Background(), aiChatTimeout)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		return "", errors.New("the AI address is not a valid URL")
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json")
	request.Header.Set("User-Agent", "MyGit")
	if key = strings.TrimSpace(key); key != "" {
		request.Header.Set("Authorization", "Bearer "+key)
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return "", fmt.Errorf("could not reach the AI service: %w", err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, aiChatBodySize))
	if err != nil {
		return "", fmt.Errorf("could not read the reply: %w", err)
	}
	if response.StatusCode < 200 || response.StatusCode > 299 {
		return "", fmt.Errorf("the AI service refused the request (%s): %s", response.Status, snippet(body))
	}
	var reply struct {
		Choices []struct {
			Message chatMessage `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(body, &reply); err != nil || len(reply.Choices) == 0 {
		return "", fmt.Errorf("the AI service returned no completion; check that the address is an OpenAI-compatible chat endpoint: %s", snippet(body))
	}
	return reply.Choices[0].Message.Content, nil
}

// cleanCommitMessage drops the wrapping a model still adds sometimes: code
// fences, quotes, and leading blank lines.
func cleanCommitMessage(reply string) (string, error) {
	text := strings.TrimSpace(reply)
	for _, fence := range []string{"```", "~~~"} {
		if strings.HasPrefix(text, fence) {
			text = strings.TrimPrefix(text, fence)
			if line, rest, ok := strings.Cut(text, "\n"); ok && !strings.Contains(line, " ") {
				text = rest
			}
			text = strings.TrimSuffix(strings.TrimSpace(text), fence)
		}
	}
	text = strings.TrimSpace(text)
	for _, quote := range []string{"`", `"`, "“", "”"} {
		if strings.HasPrefix(text, quote) && strings.HasSuffix(text, quote) && len(text) > 2*len(quote) {
			text = strings.TrimSpace(text[len(quote) : len(text)-len(quote)])
		}
	}
	if text == "" {
		return "", errors.New("the AI service returned an empty commit message")
	}
	return text, nil
}

// aiBase normalises the address saved in settings to the API root, so the
// routes MyGit appends work whether the user pasted the root, the model list
// or the chat route.
func aiBase(address string) (string, error) {
	value := strings.TrimSpace(address)
	if value == "" {
		return "", errors.New("enter the AI service address")
	}
	parsed, err := url.Parse(value)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		return "", errors.New("enter an http(s) AI address")
	}
	value = strings.TrimRight(value, "/")
	value = strings.TrimSuffix(value, "/chat/completions")
	value = strings.TrimSuffix(value, "/models")
	return value, nil
}

// modelsEndpoint turns the address saved in settings into the URL that lists
// models.
func modelsEndpoint(address string) (string, error) {
	base, err := aiBase(address)
	if err != nil {
		return "", err
	}
	return base + "/models", nil
}

// chatEndpoint turns the address saved in settings into the completions route.
func chatEndpoint(address string) (string, error) {
	base, err := aiBase(address)
	if err != nil {
		return "", err
	}
	return base + "/chat/completions", nil
}

type modelEntry struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Model   string `json:"model"`
	OwnedBy string `json:"owned_by"`
}

func parseModels(body []byte) ([]AIModel, error) {
	trimmed := bytes.TrimSpace(body)
	if len(trimmed) == 0 {
		return nil, errors.New("the AI service returned an empty model list")
	}
	var entries []modelEntry
	if trimmed[0] == '[' {
		if err := json.Unmarshal(trimmed, &entries); err != nil {
			return nil, errUnexpectedModels
		}
	} else {
		var payload struct {
			Data   []modelEntry `json:"data"`
			Models []modelEntry `json:"models"`
		}
		if err := json.Unmarshal(trimmed, &payload); err != nil {
			return nil, errUnexpectedModels
		}
		entries = append(payload.Data, payload.Models...)
	}
	seen := make(map[string]bool, len(entries))
	models := make([]AIModel, 0, len(entries))
	for _, entry := range entries {
		id := firstNonEmpty(entry.ID, entry.Model, entry.Name)
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		models = append(models, AIModel{ID: id, Owner: entry.OwnedBy})
	}
	if len(models) == 0 {
		return nil, errors.New("the service listed no models; check the address and key")
	}
	sort.Slice(models, func(i, j int) bool { return models[i].ID < models[j].ID })
	return models, nil
}

var errUnexpectedModels = errors.New("the address did not return an OpenAI-compatible model list; point it at the API root, for example https://api.example.com/v1")

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value = strings.TrimSpace(value); value != "" {
			return value
		}
	}
	return ""
}

// snippet keeps error bodies readable: one line, at most a few hundred runes.
func snippet(body []byte) string {
	text := strings.Join(strings.Fields(string(body)), " ")
	if text == "" {
		return "no details"
	}
	runes := []rune(text)
	if len(runes) > 240 {
		text = string(runes[:240]) + "…"
	}
	return text
}
