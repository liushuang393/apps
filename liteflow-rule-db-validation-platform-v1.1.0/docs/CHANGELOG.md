# Changelog

## 1.1.0 - 2026-08-01

- Fixed Grafana dashboard validation to use the packaged dashboard UID.
- Added polling for Grafana dashboard provisioning.
- Added fail-safe validator reports for unexpected runtime exceptions.
- Added persistent failure evidence files for install, validation, and run-all scripts.
- Kept Windows command windows open after failure so errors do not disappear.
- Added host preflight checks and a Java syntax/internal type compile using API stubs.
- Added checks that JUnit XML and build metadata were actually extracted.
- Updated pinned runtime images to MariaDB 11.4.12, Prometheus 3.13.1, and Grafana 13.1.1.
- Added versioned packaging and regenerated SHA-256 manifests.
