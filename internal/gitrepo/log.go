package gitrepo

// ReadLog uses the same parser for paginated history as full-history reads.
func (g Git) ReadLog(path string, args ...string) ([]Commit, error) {
	out, err := g.output(historyTimeout, path, args...)
	if err != nil {
		return nil, err
	}
	commits := parseCommits(string(out))
	if commits == nil {
		commits = []Commit{}
	}
	return commits, nil
}
