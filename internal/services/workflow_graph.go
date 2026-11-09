package services

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"

	"gopkg.in/yaml.v3"
)

// WorkflowGraph describes the dependencies declared in a run's workflow YAML.
// It is loaded separately from Jobs so unavailable source never hides run jobs.
type WorkflowGraph struct {
	Nodes []WorkflowGraphNode
}

// WorkflowGraphNode is a YAML job before matrix or reusable-workflow expansion.
// Name retains expressions verbatim; Needs contains YAML job IDs, not run job IDs.
type WorkflowGraphNode struct {
	ID    string
	Name  string
	Needs []string
}

// Graph reads job dependencies from the workflow file at the run's head commit.
func (s *WorkflowService) Graph(target WorkflowTarget, runID int64) (WorkflowGraph, error) {
	graph := WorkflowGraph{Nodes: []WorkflowGraphNode{}}
	if err := s.requireGitHub(target); err != nil {
		return graph, err
	}
	if runID <= 0 {
		return graph, errors.New("缺少运行记录 ID")
	}
	token, err := s.tokenFor(target)
	if err != nil {
		return graph, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), workflowTimeout)
	defer cancel()

	route := fmt.Sprintf("/repos/%s/%s/actions/runs/%d", url.PathEscape(target.Owner), url.PathEscape(target.Repo), runID)
	status, body, err := s.gitHub(ctx, http.MethodGet, route, nil, nil, token)
	if err != nil {
		return graph, fmt.Errorf("读取运行 %d 的工作流来源失败：%w", runID, err)
	}
	if status != http.StatusOK {
		return graph, fmt.Errorf("读取运行 %d 的工作流来源失败：%w", runID, gitHubError(status, body))
	}
	var run struct {
		Path    string `json:"path"`
		HeadSHA string `json:"head_sha"`
	}
	if err := json.Unmarshal(body, &run); err != nil {
		return graph, fmt.Errorf("无法解析运行 %d 的工作流来源：%w", runID, err)
	}
	workflowPath, err := graphWorkflowPath(run.Path)
	if err != nil {
		return graph, fmt.Errorf("无法读取运行 %d 的工作流图：%w", runID, err)
	}
	if strings.TrimSpace(run.HeadSHA) == "" {
		return graph, fmt.Errorf("运行 %d 未返回 head_sha，无法确定工作流版本", runID)
	}

	segments := strings.Split(workflowPath, "/")
	for i := range segments {
		segments[i] = url.PathEscape(segments[i])
	}
	route = fmt.Sprintf("/repos/%s/%s/contents/%s", url.PathEscape(target.Owner), url.PathEscape(target.Repo), strings.Join(segments, "/"))
	query := url.Values{"ref": {run.HeadSHA}}
	status, body, err = s.gitHub(ctx, http.MethodGet, route, query, nil, token)
	if err != nil {
		return graph, fmt.Errorf("读取工作流 %s（%s）失败：%w", workflowPath, run.HeadSHA, err)
	}
	if status != http.StatusOK {
		return graph, fmt.Errorf("读取工作流 %s（%s）失败：%w", workflowPath, run.HeadSHA, gitHubError(status, body))
	}
	var content struct {
		Type     string `json:"type"`
		Encoding string `json:"encoding"`
		Content  string `json:"content"`
	}
	if err := json.Unmarshal(body, &content); err != nil {
		return graph, fmt.Errorf("无法解析工作流 %s 的文件内容：%w", workflowPath, err)
	}
	if content.Type != "" && content.Type != "file" {
		return graph, fmt.Errorf("工作流 %s 不是文件", workflowPath)
	}
	if !strings.EqualFold(strings.TrimSpace(content.Encoding), "base64") {
		return graph, fmt.Errorf("工作流 %s 使用不支持的文件编码 %q", workflowPath, content.Encoding)
	}
	raw, err := base64.StdEncoding.DecodeString(stripWhitespace(content.Content))
	if err != nil {
		return graph, fmt.Errorf("无法解码工作流 %s：%w", workflowPath, err)
	}
	graph, err = parseWorkflowGraph(raw)
	if err != nil {
		return graph, fmt.Errorf("读取工作流 %s（%s）的依赖失败：%w", workflowPath, run.HeadSHA, err)
	}
	return graph, nil
}

// graphWorkflowPath accepts only repository-local workflow files. A reusable
// workflow's owner/repo/path@ref cannot safely be read from this run's repository
// at head_sha, so those paths deliberately fail instead of guessing the source.
func graphWorkflowPath(value string) (string, error) {
	if strings.Contains(value, "@") {
		return "", fmt.Errorf("不支持带远程引用的工作流路径 %q", value)
	}
	parts := strings.Split(value, "/")
	if len(parts) != 3 || parts[0] != ".github" || parts[1] != "workflows" {
		return "", fmt.Errorf("无效的工作流路径 %q", value)
	}
	name := parts[2]
	if strings.ContainsAny(name, "\\?#%:") || strings.TrimSpace(name) != name || strings.ContainsAny(name, "\x00\r\n\t") ||
		!(strings.HasSuffix(name, ".yml") || strings.HasSuffix(name, ".yaml")) {
		return "", fmt.Errorf("无效的工作流路径 %q", value)
	}
	return value, nil
}

func parseWorkflowGraph(data []byte) (WorkflowGraph, error) {
	graph := WorkflowGraph{Nodes: []WorkflowGraphNode{}}
	var document yaml.Node
	if err := yaml.Unmarshal(data, &document); err != nil {
		return graph, fmt.Errorf("无法解析工作流 YAML：%w", err)
	}
	root := documentRoot(&document)
	if root == nil || root.Kind != yaml.MappingNode {
		return graph, errors.New("工作流 YAML 必须是映射")
	}
	// Node unmarshalling preserves order and expressions but does not reject
	// duplicate mapping keys. Validate them before selecting any dependencies.
	var validated map[string]any
	if err := root.Decode(&validated); err != nil {
		return graph, fmt.Errorf("无效的工作流 YAML：%w", err)
	}
	jobs := mappingValue(root, "jobs")
	if jobs == nil {
		return graph, nil
	}
	if jobs.Kind != yaml.MappingNode {
		return graph, errors.New("工作流 YAML 的 jobs 必须是映射")
	}
	seen := make(map[string]bool, len(jobs.Content)/2)
	for i := 0; i+1 < len(jobs.Content); i += 2 {
		key, job := jobs.Content[i], jobs.Content[i+1]
		id := key.Value
		if key.Kind != yaml.ScalarNode || strings.TrimSpace(id) == "" || seen[id] || job.Kind != yaml.MappingNode {
			return graph, fmt.Errorf("工作流 YAML 中的任务 %q 无效或重复", id)
		}
		seen[id] = true
		node := WorkflowGraphNode{ID: id, Name: id, Needs: []string{}}
		if name := mappingValue(job, "name"); name != nil {
			if name.Kind != yaml.ScalarNode {
				return graph, fmt.Errorf("任务 %q 的 name 必须是字符串", id)
			}
			if strings.TrimSpace(name.Value) != "" && name.Tag != "!!null" {
				node.Name = name.Value
			}
		}
		if needs := mappingValue(job, "needs"); needs != nil {
			dependencies := needs.Content
			switch needs.Kind {
			case yaml.ScalarNode:
				dependencies = []*yaml.Node{needs}
			case yaml.SequenceNode:
			default:
				return graph, fmt.Errorf("任务 %q 的 needs 必须是任务 ID 或列表", id)
			}
			for _, dependency := range dependencies {
				if dependency.Kind != yaml.ScalarNode || dependency.Tag != "!!str" || strings.TrimSpace(dependency.Value) == "" {
					return graph, fmt.Errorf("任务 %q 的 needs 包含无效任务 ID", id)
				}
				node.Needs = append(node.Needs, dependency.Value)
			}
		}
		graph.Nodes = append(graph.Nodes, node)
	}
	return graph, nil
}
