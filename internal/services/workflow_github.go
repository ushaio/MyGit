package services

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"gopkg.in/yaml.v3"
)

// workflowBodyLimit bounds how much of a GitHub response body we read.
const workflowBodyLimit = 4 << 20

// ResolveTarget turns a remote name and URL into a WorkflowTarget. It accepts
// https://, ssh:// and the scp-like git@host:owner/repo forms, and rejects hosts
// MyGit cannot manage.
func (s *WorkflowService) ResolveTarget(remoteName, remoteURL string) (WorkflowTarget, error) {
	host, path, err := splitRemote(remoteURL)
	if err != nil {
		return WorkflowTarget{}, err
	}
	owner, repo := splitOwnerRepo(path)

	target := WorkflowTarget{Owner: owner, Repo: repo, Remote: remoteName, Host: host}
	switch host {
	case "github.com":
		target.Platform = "github"
		target.APIHost = "api.github.com"
	case "gitee.com":
		target.Platform = "gitee"
	case "gitcode.com", "gitcode.net":
		target.Platform = "gitcode"
	default:
		return WorkflowTarget{}, fmt.Errorf("不支持远程主机 %q：MyGit 可管理 GitHub Actions，并可打开 Gitee/GitCode 仓库", host)
	}
	if owner == "" || repo == "" {
		return WorkflowTarget{}, fmt.Errorf("无法从远程地址 %q 解析出 owner/repo", remoteURL)
	}
	target.WebURL = "https://" + host + "/" + owner + "/" + repo
	return target, nil
}

// splitRemote returns the canonical (lower-case, www-stripped) host and the
// path portion of a Git remote URL.
func splitRemote(remoteURL string) (host, path string, err error) {
	raw := strings.TrimSpace(remoteURL)
	if raw == "" {
		return "", "", errors.New("远程仓库没有 URL")
	}

	if i := strings.Index(raw, "://"); i >= 0 {
		parsed, parseErr := url.Parse(raw)
		if parseErr != nil || parsed.Host == "" {
			return "", "", fmt.Errorf("无法解析远程地址 %q", remoteURL)
		}
		host = parsed.Hostname()
		path = parsed.Path
	} else if at := strings.LastIndex(raw, "@"); at >= 0 {
		// scp-like: git@host:owner/repo (also user@host:path)
		afterAt := raw[at+1:]
		colon := strings.Index(afterAt, ":")
		if colon < 0 {
			return "", "", fmt.Errorf("无法解析远程地址 %q", remoteURL)
		}
		host = afterAt[:colon]
		path = afterAt[colon+1:]
	} else if colon := strings.Index(raw, ":"); colon >= 0 && !strings.Contains(raw[:colon], "/") {
		// host:owner/repo without a user
		host = raw[:colon]
		path = raw[colon+1:]
	} else if slash := strings.Index(raw, "/"); slash >= 0 {
		// bare host/owner/repo
		host = raw[:slash]
		path = raw[slash:]
	} else {
		return "", "", fmt.Errorf("无法解析远程地址 %q", remoteURL)
	}

	host = strings.ToLower(strings.TrimSpace(host))
	host = strings.TrimPrefix(host, "www.")
	if host == "" {
		return "", "", fmt.Errorf("无法从远程地址 %q 读取主机", remoteURL)
	}
	return host, path, nil
}

// splitOwnerRepo takes the first two path segments as owner and repo, stripping
// a trailing .git and dropping leading slashes.
func splitOwnerRepo(path string) (owner, repo string) {
	if i := strings.IndexAny(path, "?#"); i >= 0 {
		path = path[:i]
	}
	segments := strings.Split(strings.Trim(path, "/"), "/")
	parts := make([]string, 0, len(segments))
	for _, segment := range segments {
		if segment != "" {
			parts = append(parts, segment)
		}
	}
	if len(parts) == 0 {
		return "", ""
	}
	owner = parts[0]
	if len(parts) >= 2 {
		repo = strings.TrimSuffix(parts[1], ".git")
	}
	return owner, repo
}

// ListWorkflows returns one page of a repository's workflows.
func (s *WorkflowService) ListWorkflows(target WorkflowTarget, page int) (WorkflowList, error) {
	list := WorkflowList{Page: normalizePage(page), PerPage: workflowPerPage}
	if err := s.requireGitHub(target); err != nil {
		return list, err
	}
	token, err := s.tokenFor(target)
	if err != nil {
		return list, err
	}
	query := url.Values{}
	query.Set("per_page", strconv.Itoa(workflowPerPage))
	query.Set("page", strconv.Itoa(list.Page))

	ctx, cancel := context.WithTimeout(context.Background(), workflowTimeout)
	defer cancel()
	status, body, err := s.gitHub(ctx, http.MethodGet, workflowsRoute(target), query, nil, token)
	if err != nil {
		return list, err
	}
	if status != http.StatusOK {
		return list, gitHubError(status, body)
	}

	var payload struct {
		TotalCount int `json:"total_count"`
		Workflows  []struct {
			ID      int64  `json:"id"`
			Name    string `json:"name"`
			Path    string `json:"path"`
			State   string `json:"state"`
			HTMLURL string `json:"html_url"`
		} `json:"workflows"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return list, fmt.Errorf("无法解析 GitHub 的工作流列表：%w", err)
	}
	list.Total = payload.TotalCount
	list.Workflows = make([]Workflow, 0, len(payload.Workflows))
	for _, item := range payload.Workflows {
		list.Workflows = append(list.Workflows, Workflow{
			ID:      item.ID,
			Name:    item.Name,
			Path:    item.Path,
			State:   item.State,
			HTMLURL: item.HTMLURL,
		})
	}
	list.HasMore = list.Page*workflowPerPage < list.Total
	return list, nil
}

// ListRuns returns one page of run history, optionally scoped to a workflow and
// a branch.
func (s *WorkflowService) ListRuns(target WorkflowTarget, workflowID int64, branch string, page int) (WorkflowRuns, error) {
	runs := WorkflowRuns{Page: normalizePage(page), PerPage: workflowPerPage}
	if err := s.requireGitHub(target); err != nil {
		return runs, err
	}
	token, err := s.tokenFor(target)
	if err != nil {
		return runs, err
	}
	query := url.Values{}
	query.Set("per_page", strconv.Itoa(workflowPerPage))
	query.Set("page", strconv.Itoa(runs.Page))
	if trimmed := strings.TrimSpace(branch); trimmed != "" {
		query.Set("branch", trimmed)
	}

	route := fmt.Sprintf("/repos/%s/%s/actions/runs", target.Owner, target.Repo)
	if workflowID > 0 {
		route = fmt.Sprintf("/repos/%s/%s/actions/workflows/%d/runs", target.Owner, target.Repo, workflowID)
	}

	ctx, cancel := context.WithTimeout(context.Background(), workflowTimeout)
	defer cancel()
	status, body, err := s.gitHub(ctx, http.MethodGet, route, query, nil, token)
	if err != nil {
		return runs, err
	}
	if status != http.StatusOK {
		return runs, gitHubError(status, body)
	}

	var payload struct {
		TotalCount int `json:"total_count"`
		Runs       []struct {
			ID           int64  `json:"id"`
			WorkflowID   int64  `json:"workflow_id"`
			RunNumber    int    `json:"run_number"`
			Name         string `json:"name"`
			DisplayTitle string `json:"display_title"`
			Status       string `json:"status"`
			Conclusion   string `json:"conclusion"`
			HeadBranch   string `json:"head_branch"`
			HeadSHA      string `json:"head_sha"`
			Event        string `json:"event"`
			CreatedAt    string `json:"created_at"`
			UpdatedAt    string `json:"updated_at"`
			HTMLURL      string `json:"html_url"`
		} `json:"workflow_runs"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return runs, fmt.Errorf("无法解析 GitHub 的运行记录：%w", err)
	}
	runs.Total = payload.TotalCount
	runs.Runs = make([]WorkflowRun, 0, len(payload.Runs))
	for _, item := range payload.Runs {
		runs.Runs = append(runs.Runs, WorkflowRun{
			ID:         item.ID,
			WorkflowID: item.WorkflowID,
			Number:     item.RunNumber,
			Title:      firstNonEmpty(item.DisplayTitle, item.Name),
			Status:     item.Status,
			Conclusion: item.Conclusion,
			Branch:     item.HeadBranch,
			HeadSHA:    item.HeadSHA,
			Event:      item.Event,
			CreatedAt:  item.CreatedAt,
			UpdatedAt:  item.UpdatedAt,
			HTMLURL:    item.HTMLURL,
		})
	}
	runs.HasMore = runs.Page*workflowPerPage < runs.Total
	return runs, nil
}

// Jobs returns the jobs (and their steps) of one run, which is what the panel
// shows when a run is expanded.
func (s *WorkflowService) Jobs(target WorkflowTarget, runID int64) (WorkflowJobs, error) {
	jobs := WorkflowJobs{}
	if err := s.requireGitHub(target); err != nil {
		return jobs, err
	}
	if runID <= 0 {
		return jobs, errors.New("缺少运行记录 ID")
	}
	token, err := s.tokenFor(target)
	if err != nil {
		return jobs, err
	}
	query := url.Values{}
	query.Set("per_page", "100")
	query.Set("page", "1")

	ctx, cancel := context.WithTimeout(context.Background(), workflowTimeout)
	defer cancel()
	route := fmt.Sprintf("/repos/%s/%s/actions/runs/%d/jobs", target.Owner, target.Repo, runID)
	status, body, err := s.gitHub(ctx, http.MethodGet, route, query, nil, token)
	if err != nil {
		return jobs, err
	}
	if status != http.StatusOK {
		return jobs, gitHubError(status, body)
	}

	var payload struct {
		TotalCount int `json:"total_count"`
		Jobs       []struct {
			ID          int64  `json:"id"`
			RunID       int64  `json:"run_id"`
			Name        string `json:"name"`
			Status      string `json:"status"`
			Conclusion  string `json:"conclusion"`
			StartedAt   string `json:"started_at"`
			CompletedAt string `json:"completed_at"`
			Steps       []struct {
				Number      int    `json:"number"`
				Name        string `json:"name"`
				Status      string `json:"status"`
				Conclusion  string `json:"conclusion"`
				StartedAt   string `json:"started_at"`
				CompletedAt string `json:"completed_at"`
			} `json:"steps"`
		} `json:"jobs"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return jobs, fmt.Errorf("无法解析 GitHub 的任务列表：%w", err)
	}
	jobs.Total = payload.TotalCount
	jobs.Jobs = make([]WorkflowJob, 0, len(payload.Jobs))
	for _, item := range payload.Jobs {
		job := WorkflowJob{
			ID:          item.ID,
			RunID:       item.RunID,
			Name:        item.Name,
			Status:      item.Status,
			Conclusion:  item.Conclusion,
			StartedAt:   item.StartedAt,
			CompletedAt: item.CompletedAt,
			Steps:       make([]WorkflowStep, 0, len(item.Steps)),
		}
		for _, step := range item.Steps {
			job.Steps = append(job.Steps, WorkflowStep{
				Number:      step.Number,
				Name:        step.Name,
				Status:      step.Status,
				Conclusion:  step.Conclusion,
				StartedAt:   step.StartedAt,
				CompletedAt: step.CompletedAt,
			})
		}
		jobs.Jobs = append(jobs.Jobs, job)
	}
	return jobs, nil
}

// Inputs reads the workflow_dispatch input definitions from the file at ref.
func (s *WorkflowService) Inputs(target WorkflowTarget, workflowPath, ref string) ([]WorkflowInput, error) {
	if err := s.requireGitHub(target); err != nil {
		return nil, err
	}
	trimmedPath := strings.TrimPrefix(strings.TrimSpace(workflowPath), "/")
	if trimmedPath == "" {
		return nil, errors.New("缺少工作流文件路径")
	}
	token, err := s.tokenFor(target)
	if err != nil {
		return nil, err
	}
	query := url.Values{}
	if trimmed := strings.TrimSpace(ref); trimmed != "" {
		query.Set("ref", trimmed)
	}

	ctx, cancel := context.WithTimeout(context.Background(), workflowTimeout)
	defer cancel()
	route := fmt.Sprintf("/repos/%s/%s/contents/%s", target.Owner, target.Repo, trimmedPath)
	status, body, err := s.gitHub(ctx, http.MethodGet, route, query, nil, token)
	if err != nil {
		return nil, err
	}
	if status != http.StatusOK {
		return nil, gitHubError(status, body)
	}

	var content struct {
		Content  string `json:"content"`
		Encoding string `json:"encoding"`
	}
	if err := json.Unmarshal(body, &content); err != nil {
		return nil, fmt.Errorf("无法解析 GitHub 的文件内容：%w", err)
	}
	if strings.TrimSpace(content.Content) == "" {
		return []WorkflowInput{}, nil
	}
	encoding := strings.ToLower(strings.TrimSpace(content.Encoding))
	if encoding != "" && encoding != "base64" {
		return nil, fmt.Errorf("不支持的文件编码 %q", content.Encoding)
	}
	raw, err := base64.StdEncoding.DecodeString(stripWhitespace(content.Content))
	if err != nil {
		return nil, fmt.Errorf("无法解码工作流文件：%w", err)
	}
	return parseWorkflowInputs(raw)
}

// Dispatch triggers a workflow_dispatch run. The value for each input is taken
// from its Default field; only non-empty values are sent, and missing required
// inputs are rejected before the request.
func (s *WorkflowService) Dispatch(target WorkflowTarget, workflowID int64, ref string, inputs []WorkflowInput) error {
	if err := s.requireGitHub(target); err != nil {
		return err
	}
	if workflowID <= 0 {
		return errors.New("缺少要触发的工作流 ID")
	}
	trimmedRef := strings.TrimSpace(ref)
	if trimmedRef == "" {
		return errors.New("请选择要运行工作流的分支或标签（ref）")
	}
	body := struct {
		Ref    string            `json:"ref"`
		Inputs map[string]string `json:"inputs"`
	}{Ref: trimmedRef, Inputs: make(map[string]string)}
	for _, input := range inputs {
		name := strings.TrimSpace(input.Name)
		if name == "" {
			continue
		}
		value := strings.TrimSpace(input.Default)
		if value == "" {
			if input.Required {
				return fmt.Errorf("参数 %q 为必填项", name)
			}
			continue
		}
		body.Inputs[name] = value
	}
	payload, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("无法构建触发请求：%w", err)
	}
	token, err := s.tokenFor(target)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), workflowTimeout)
	defer cancel()
	route := fmt.Sprintf("/repos/%s/%s/actions/workflows/%d/dispatches", target.Owner, target.Repo, workflowID)
	status, respBody, err := s.gitHub(ctx, http.MethodPost, route, nil, payload, token)
	if err != nil {
		return err
	}
	if status >= 200 && status <= 299 {
		return nil
	}
	return gitHubError(status, respBody)
}

// Rerun re-runs a completed workflow run.
func (s *WorkflowService) Rerun(target WorkflowTarget, runID int64) error {
	return s.runAction(target, runID, "rerun")
}

// Cancel cancels an in-progress workflow run.
func (s *WorkflowService) Cancel(target WorkflowTarget, runID int64) error {
	return s.runAction(target, runID, "cancel")
}

// runAction posts to one of a run's action routes (rerun/cancel).
func (s *WorkflowService) runAction(target WorkflowTarget, runID int64, action string) error {
	if err := s.requireGitHub(target); err != nil {
		return err
	}
	if runID <= 0 {
		return errors.New("缺少运行记录 ID")
	}
	token, err := s.tokenFor(target)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), workflowTimeout)
	defer cancel()
	route := fmt.Sprintf("/repos/%s/%s/actions/runs/%d/%s", target.Owner, target.Repo, runID, action)
	status, body, err := s.gitHub(ctx, http.MethodPost, route, nil, nil, token)
	if err != nil {
		return err
	}
	if status >= 200 && status <= 299 {
		return nil
	}
	return gitHubError(status, body)
}

// verifyToken calls GET /user and returns the login, so SaveToken can reject a
// bad token before storing it. The token is sent only to the configured API base.
func (s *WorkflowService) verifyToken(token string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), workflowTimeout)
	defer cancel()
	status, body, err := s.gitHub(ctx, http.MethodGet, "/user", nil, nil, token)
	if err != nil {
		return "", err
	}
	if status != http.StatusOK {
		return "", gitHubError(status, body)
	}
	var user struct {
		Login string `json:"login"`
	}
	if err := json.Unmarshal(body, &user); err != nil || strings.TrimSpace(user.Login) == "" {
		return "", fmt.Errorf("GitHub 未返回该令牌的登录名：%s", snippet(body))
	}
	return strings.TrimSpace(user.Login), nil
}

// gitHub performs one request against the configured API base. The token, when
// present, is only ever sent here — never to an arbitrary remote host.
func (s *WorkflowService) gitHub(ctx context.Context, method, route string, query url.Values, payload []byte, token string) (int, []byte, error) {
	endpoint := strings.TrimRight(s.apiBase, "/") + route
	if len(query) > 0 {
		endpoint += "?" + query.Encode()
	}
	var reader io.Reader
	if payload != nil {
		reader = bytes.NewReader(payload)
	}
	request, err := http.NewRequestWithContext(ctx, method, endpoint, reader)
	if err != nil {
		return 0, nil, fmt.Errorf("无法构建 GitHub 请求：%w", err)
	}
	request.Header.Set("Accept", "application/vnd.github+json")
	request.Header.Set("User-Agent", "MyGit")
	if payload != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	if strings.TrimSpace(token) != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}
	response, err := s.client.Do(request)
	if err != nil {
		return 0, nil, fmt.Errorf("无法连接 GitHub：%w", err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, workflowBodyLimit))
	if err != nil {
		return response.StatusCode, nil, fmt.Errorf("无法读取 GitHub 响应：%w", err)
	}
	return response.StatusCode, body, nil
}

// workflowsRoute is the path to a repository's workflow list.
func workflowsRoute(target WorkflowTarget) string {
	return fmt.Sprintf("/repos/%s/%s/actions/workflows", target.Owner, target.Repo)
}

// requireGitHub rejects non-GitHub targets and incomplete ones.
func (s *WorkflowService) requireGitHub(target WorkflowTarget) error {
	if target.Platform != "github" {
		return unsupportedPlatformError(target.Platform)
	}
	if target.Owner == "" || target.Repo == "" {
		return errors.New("目标缺少 owner 或 repo")
	}
	return nil
}

// normalizePage clamps a page number to at least 1.
func normalizePage(page int) int {
	if page < 1 {
		return 1
	}
	return page
}

// gitHubError maps the GitHub status codes the panel cares about to readable
// messages, with a one-line truncated body.
func gitHubError(status int, body []byte) error {
	detail := snippet(body)
	switch status {
	case http.StatusUnauthorized:
		return fmt.Errorf("令牌无效或已过期（401）：%s", detail)
	case http.StatusForbidden:
		return fmt.Errorf("权限不足或触发限流（403）：%s", detail)
	case http.StatusNotFound:
		return fmt.Errorf("仓库不存在、Actions 未启用或无权访问（404）：%s", detail)
	case http.StatusTooManyRequests:
		return fmt.Errorf("触发 GitHub 限流，请稍后重试（429）：%s", detail)
	default:
		return fmt.Errorf("GitHub 请求失败（%d）：%s", status, detail)
	}
}

// stripWhitespace removes the newlines GitHub inserts into base64 content.
func stripWhitespace(value string) string {
	return strings.Join(strings.Fields(value), "")
}

// parseWorkflowInputs reads on.workflow_dispatch.inputs from workflow YAML. The
// `on` key can be a string, a list or a mapping; a scalar or list form has no
// inputs. Returns an empty slice (not nil) when there is nothing to parse.
func parseWorkflowInputs(data []byte) ([]WorkflowInput, error) {
	var document yaml.Node
	if err := yaml.Unmarshal(data, &document); err != nil {
		return nil, fmt.Errorf("无法解析工作流 YAML：%w", err)
	}
	root := documentRoot(&document)
	if root == nil || root.Kind != yaml.MappingNode {
		return []WorkflowInput{}, nil
	}

	onNode := mappingValue(root, "on")
	if onNode == nil {
		return []WorkflowInput{}, nil
	}
	if onNode.Kind != yaml.MappingNode {
		return []WorkflowInput{}, nil
	}
	dispatchNode := mappingValue(onNode, "workflow_dispatch")
	if dispatchNode == nil || dispatchNode.Kind != yaml.MappingNode {
		return []WorkflowInput{}, nil
	}
	inputsNode := mappingValue(dispatchNode, "inputs")
	if inputsNode == nil || inputsNode.Kind != yaml.MappingNode {
		return []WorkflowInput{}, nil
	}

	inputs := make([]WorkflowInput, 0, len(inputsNode.Content)/2)
	for i := 0; i+1 < len(inputsNode.Content); i += 2 {
		name := inputsNode.Content[i].Value
		spec := inputsNode.Content[i+1]
		if name == "" || spec.Kind != yaml.MappingNode {
			continue
		}
		input := WorkflowInput{Name: name, Type: "string"}
		if typeNode := mappingValue(spec, "type"); typeNode != nil {
			input.Type = scalarString(typeNode)
		}
		if descriptionNode := mappingValue(spec, "description"); descriptionNode != nil {
			input.Description = scalarString(descriptionNode)
		}
		if requiredNode := mappingValue(spec, "required"); requiredNode != nil {
			input.Required = scalarBool(requiredNode)
		}
		if defaultNode := mappingValue(spec, "default"); defaultNode != nil {
			input.Default = scalarString(defaultNode)
		}
		if optionsNode := mappingValue(spec, "options"); optionsNode != nil && optionsNode.Kind == yaml.SequenceNode {
			options := make([]string, 0, len(optionsNode.Content))
			for _, option := range optionsNode.Content {
				options = append(options, scalarString(option))
			}
			input.Options = options
		}
		inputs = append(inputs, input)
	}
	return inputs, nil
}

// documentRoot unwraps a document node to its first content node.
func documentRoot(document *yaml.Node) *yaml.Node {
	if document == nil {
		return nil
	}
	if document.Kind == yaml.DocumentNode {
		if len(document.Content) == 0 {
			return nil
		}
		return document.Content[0]
	}
	return document
}

// mappingValue returns the value node for key in a mapping node, or nil. It also
// accepts a "true" key for the YAML 1.1 reading of an unquoted `on:`.
func mappingValue(mapping *yaml.Node, key string) *yaml.Node {
	if mapping == nil || mapping.Kind != yaml.MappingNode {
		return nil
	}
	for i := 0; i+1 < len(mapping.Content); i += 2 {
		name := mapping.Content[i].Value
		if name == key || (key == "on" && name == "true") {
			return mapping.Content[i+1]
		}
	}
	return nil
}

// scalarString reads a scalar node's literal, including a boolean default like
// `default: true` (its Value is "true").
func scalarString(node *yaml.Node) string {
	if node == nil {
		return ""
	}
	return node.Value
}

// scalarBool reads a boolean-ish node.
func scalarBool(node *yaml.Node) bool {
	if node == nil {
		return false
	}
	var value bool
	if err := node.Decode(&value); err == nil {
		return value
	}
	return strings.EqualFold(strings.TrimSpace(node.Value), "true")
}
