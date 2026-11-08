package workspace

import (
	"context"
	"os/exec"
	"strings"
	"time"
)

// knownSources fixes the order a repository's sources are reported in. The
// sidebar renders one tab per source in this order, so a new platform only
// needs an entry here and a host mapping in repositorySource.
var knownSources = []string{"github", "gitee", "gitcode"}

// remoteHost returns the lower-case host of a Git remote URL, such as
// github.com, or an empty string when it cannot be read. It understands URL
// forms with a scheme, the scp-like git@host:owner/repo form, and a bare
// host/owner/repo spelling.
func remoteHost(remote string) string {
	remote = strings.TrimSpace(remote)
	if remote == "" {
		return ""
	}
	if i := strings.Index(remote, "://"); i >= 0 {
		rest := remote[i+3:]
		if at := strings.LastIndex(rest, "@"); at >= 0 {
			rest = rest[at+1:]
		}
		if end := strings.IndexAny(rest, "/:"); end >= 0 {
			rest = rest[:end]
		}
		return strings.ToLower(rest)
	}
	if at := strings.LastIndex(remote, "@"); at >= 0 {
		rest := remote[at+1:]
		if end := strings.IndexAny(rest, ":/"); end >= 0 {
			rest = rest[:end]
		}
		return strings.ToLower(rest)
	}
	if end := strings.Index(remote, "/"); end >= 0 {
		remote = remote[:end]
	}
	return strings.ToLower(remote)
}

// repositorySource maps a remote URL to the name of a source MyGit draws an
// icon for, or an empty string for any other host.
func repositorySource(remote string) string {
	switch remoteHost(remote) {
	case "github.com", "www.github.com":
		return "github"
	case "gitee.com", "www.gitee.com":
		return "gitee"
	case "gitcode.com", "www.gitcode.com", "gitcode.net", "www.gitcode.net":
		return "gitcode"
	}
	return ""
}

// repositorySources maps every remote URL to its source, dropping unknown
// hosts and duplicates. A repository can be published on several hosts at
// once, so the sidebar lists it under each of their tabs.
func repositorySources(remotes []string) []string {
	seen := make(map[string]bool, len(remotes))
	for _, remote := range remotes {
		if source := repositorySource(remote); source != "" {
			seen[source] = true
		}
	}
	sources := make([]string, 0, len(seen))
	for _, source := range knownSources {
		if seen[source] {
			sources = append(sources, source)
		}
	}
	return sources
}

// readRepositorySources returns every source a repository's remotes point at
// and the source of its preferred remote (origin when present, else the first
// source in known order). Discovery runs Git once per repository for it.
func readRepositorySources(ctx context.Context, git, path string, env []string) ([]string, string) {
	probeCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	cmd := exec.CommandContext(probeCtx, git, "-C", path, "remote", "-v")
	hideConsole(cmd)
	cmd.Env = env
	output, err := cmd.Output()
	if err != nil {
		return nil, ""
	}
	origin := ""
	var remotes []string
	for _, line := range strings.Split(string(output), "\n") {
		fields := strings.SplitN(line, "\t", 2)
		if len(fields) != 2 || !strings.Contains(fields[1], "(fetch)") {
			continue
		}
		url := strings.TrimSpace(strings.TrimSuffix(strings.TrimSpace(fields[1]), "(fetch)"))
		if fields[0] == "origin" {
			origin = url
		}
		remotes = append(remotes, url)
	}
	sources := repositorySources(remotes)
	primary := repositorySource(origin)
	// A repository whose preferred remote lives on an unknown host still
	// leads with one of the hosts it is mirrored on.
	if primary == "" && len(sources) > 0 {
		primary = sources[0]
	}
	return sources, primary
}
