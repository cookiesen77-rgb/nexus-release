# Electron Packaging Notes

## Status Check
- `npm run build` completed successfully before Electron integration.

## What Was Added
- Electron main process and preload in `electron/`.
- Electron-specific Vite mode to use relative asset paths.
- Hash-based routing in Electron mode to avoid file URL reload issues.
- Packaging configuration via `electron-builder`.
- macOS hardened runtime entitlements and notarization hook.

## Scripts
- Web dev: `npm run dev`
- Electron dev: `npm run dev:electron`
- Web build: `npm run build`
- Electron build: `npm run build:electron`
- Electron build (local, unsigned): `npm run build:electron:local`
- Electron build (local, unpacked dir): `npm run build:electron:local:dir`

## Build Output
- Packaged artifacts go to `release/`.

## macOS Signing and Notarization
1. Install a "Developer ID Application" certificate into the login keychain.
2. Export the following environment variables before building:
   - `APPLE_ID`
   - `APPLE_APP_SPECIFIC_PASSWORD`
   - `APPLE_TEAM_ID`
3. Run: `npm run build:electron`

## Local Build (No Signing / No Notarization)
- If you don't have a "Developer ID Application" certificate, use:
  - `npm run build:electron:local` (still creates installer artifacts when possible)
  - `npm run build:electron:local:dir` (faster, produces an unpacked app folder)
- These scripts disable code signing auto-discovery and turn off `mac.hardenedRuntime` to avoid build failures on machines without signing identities.

## Setup Notes
1. Install new dev dependencies: `npm install`
2. Run Electron dev: `npm run dev:electron`
3. Package the app: `npm run build:electron`
