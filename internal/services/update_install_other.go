//go:build !windows

package services

import "errors"

// In-place update installation currently targets the Windows NSIS/MSI
// installers; other platforms report a clear error instead of opening a file.
func (s *AppService) launchInstaller(string) error {
	return errors.New("in-app updates are supported on Windows only")
}
