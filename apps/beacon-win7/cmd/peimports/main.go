// Command peimports fails when a Windows executable statically imports a DLL
// outside an allowlist. Go resolves most Windows APIs lazily at run time, so
// the static import table is short; a new entry there is the kind of change
// that can stop a binary from even loading on Windows 7.
//
// Usage: peimports -allow kernel32.dll,... file.exe...
package main

import (
	"debug/pe"
	"flag"
	"fmt"
	"os"
	"sort"
	"strings"
)

func importedDLLs(path string) ([]string, error) {
	file, err := pe.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	libraries, err := file.ImportedLibraries()
	if err != nil {
		return nil, err
	}
	symbols, err := file.ImportedSymbols()
	if err != nil {
		return nil, err
	}
	seen := make(map[string]struct{})
	for _, library := range libraries {
		seen[strings.ToLower(library)] = struct{}{}
	}
	for _, symbol := range symbols {
		if _, library, found := strings.Cut(symbol, ":"); found {
			seen[strings.ToLower(library)] = struct{}{}
		}
	}
	dlls := make([]string, 0, len(seen))
	for dll := range seen {
		dlls = append(dlls, dll)
	}
	sort.Strings(dlls)
	return dlls, nil
}

func main() {
	allow := flag.String("allow", "", "comma-separated DLL names an executable may import")
	flag.Parse()
	allowed := make(map[string]struct{})
	for _, name := range strings.Split(*allow, ",") {
		if name = strings.TrimSpace(strings.ToLower(name)); name != "" {
			allowed[name] = struct{}{}
		}
	}
	if flag.NArg() == 0 {
		fmt.Fprintln(os.Stderr, "usage: peimports -allow a.dll,b.dll file.exe...")
		os.Exit(2)
	}
	failed := false
	for _, path := range flag.Args() {
		dlls, err := importedDLLs(path)
		if err != nil {
			fmt.Fprintf(os.Stderr, "%s: %v\n", path, err)
			failed = true
			continue
		}
		fmt.Printf("%s: %s\n", path, strings.Join(dlls, ", "))
		for _, dll := range dlls {
			if _, ok := allowed[dll]; !ok {
				fmt.Fprintf(os.Stderr, "%s imports %s, which is not on the allowlist\n", path, dll)
				failed = true
			}
		}
	}
	if failed {
		os.Exit(1)
	}
}
