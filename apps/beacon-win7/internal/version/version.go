// Package version holds the beacon version reported in the hello frame.
package version

// Version is overridden at build time with
// -ldflags "-X github.com/cuongtranba/kanna/apps/beacon-win7/internal/version.Version=<version>".
var Version = "0.0.0-dev"
