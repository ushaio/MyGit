// Command version prints the product version declared in build/config.yml
// (the info.version field). Taskfiles use it to version artifact filenames
// without depending on platform-specific shell parsing.
package main

import (
	"bufio"
	"fmt"
	"os"
	"strings"
)

func main() {
	f, err := os.Open("build/config.yml")
	if err != nil {
		fmt.Fprintln(os.Stderr, "version: cannot open build/config.yml:", err)
		os.Exit(1)
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := scanner.Text()
		// The product version is the two-space indented `version:` entry under
		// the `info:` block (the top-level go-task `version: '3'` has no indent).
		if strings.HasPrefix(line, "  version:") {
			v := strings.TrimSpace(strings.TrimPrefix(line, "  version:"))
			v = strings.Trim(v, `"'`)
			if v != "" {
				fmt.Println(v)
				return
			}
		}
	}
	if err := scanner.Err(); err != nil {
		fmt.Fprintln(os.Stderr, "version: read error:", err)
		os.Exit(1)
	}
	fmt.Fprintln(os.Stderr, "version: no info.version found in build/config.yml")
	os.Exit(1)
}
