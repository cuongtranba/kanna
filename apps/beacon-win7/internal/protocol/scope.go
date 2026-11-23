package protocol

import "strings"

type normalizedPath struct {
	absolute bool
	drive    string
	hasDrive bool
	unc      bool
	segments []string
}

func isWindowsDrive(part string) bool {
	if len(part) != 2 || part[1] != ':' {
		return false
	}
	c := part[0]
	return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z')
}

func normalizePath(path string) normalizedPath {
	slashed := strings.ReplaceAll(path, "\\", "/")
	parts := strings.Split(slashed, "/")
	leadingSeparator := len(parts) > 1 && parts[0] == ""
	named := make([]string, 0, len(parts))
	for _, part := range parts {
		if part != "" && part != "." {
			named = append(named, part)
		}
	}
	result := normalizedPath{unc: len(slashed) > 2 && slashed[:2] == "//" && slashed[2] != '/'}
	rest := named
	if len(named) > 0 && isWindowsDrive(named[0]) {
		result.drive = strings.ToUpper(named[0])
		result.hasDrive = true
		rest = named[1:]
	}
	result.absolute = leadingSeparator || result.hasDrive
	segments := make([]string, 0, len(rest))
	for _, part := range rest {
		if part != ".." {
			segments = append(segments, part)
			continue
		}
		if n := len(segments); n > 0 && segments[n-1] != ".." {
			segments = segments[:n-1]
		} else if !result.absolute {
			segments = append(segments, part)
		}
	}
	result.segments = segments
	return result
}

func isInsideRoot(target, root normalizedPath) bool {
	if !root.absolute && len(root.segments) == 0 {
		return false
	}
	if target.absolute != root.absolute || target.hasDrive != root.hasDrive || target.drive != root.drive {
		return false
	}
	if len(root.segments) > len(target.segments) {
		return false
	}
	for index, segment := range root.segments {
		if index == 0 && root.unc {
			if !strings.EqualFold(target.segments[0], segment) {
				return false
			}
		} else if target.segments[index] != segment {
			return false
		}
	}
	return true
}

// IsPathInsideRoots mirrors isPathInsideRoots in src/shared/beacon-scope.ts:
// pure string logic over "/" and "\" separators, an upper-cased drive letter,
// ".." resolution, and case-sensitive segment comparison, except that the
// server name of a UNC root (\\server\...) compares case-insensitively.
func IsPathInsideRoots(target string, roots []string) bool {
	normalizedTarget := normalizePath(target)
	for _, root := range roots {
		if isInsideRoot(normalizedTarget, normalizePath(root)) {
			return true
		}
	}
	return false
}
