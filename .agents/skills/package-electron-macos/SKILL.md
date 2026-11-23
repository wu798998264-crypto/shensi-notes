---
name: package-electron-macos
description: Package a Windows-developed Electron desktop application into macOS DMG releases using GitHub Actions macOS runners, while preserving or rebuilding Windows EXE artifacts when needed. Use when the user asks to convert/package/build a Windows desktop app for Apple/macOS, create Apple silicon and Intel Mac installers, publish DMG download links, troubleshoot macOS "damaged app" Gatekeeper issues, handle unsigned Windows Smart App Control warnings, or set up repeatable cross-platform Electron packaging from a Windows workspace.
---

# Electron macOS Packaging from Windows

Use this skill when an Electron desktop app is developed on Windows but needs macOS packages. The standard method is to keep Windows builds local and use GitHub Actions `macos-latest` runners to build macOS DMG files.

## First Checks

Identify the project shape before editing:

- Confirm it is an Electron project: `package.json` has `main`, `electron`, and usually `electron-builder`.
- Read `package.json` build config, scripts, app name, product name, app id, version, icon paths, and platform-specific resources.
- Check whether the project has native Windows-only helpers (`.exe`, `.cs`, `.dll`, PowerShell helpers). These must usually be excluded from macOS packaging.
- Check git state before editing. Do not stage unrelated temporary files, old artifacts, backups, downloaded zips, or `dist` unless explicitly asked.

Useful commands:

```powershell
git status --short --branch
Get-Content package.json
rg -n "electron|electron-builder|appId|productName|artifactName|asar|extraResources|asarUnpack|win|mac|dmg" package.json .github src scripts -S
```

## Versioning Rules

Do not only rename final files. If the user asks for a new version:

- Update root `package.json` `version`.
- Update `build.productName` if visible product name changes.
- Update Windows artifact names if present.
- Update HTML/window titles and in-app labels if they show the version.
- Update `package-lock.json` root package version entries.
- Update macOS Release tag/body/expected filenames in workflow.
- Keep `appId` stable unless the user explicitly wants a new application identity. Changing `appId` can reset Windows/macOS trust and app data identity.
- Preserve migration paths for older app names so user data is not lost.

Search for old app-facing labels, but leave dependency versions alone:

```powershell
rg -n "OLD_VERSION|Old Product Name|old-release-tag" package.json package-lock.json index.html src .github scripts -S
```

## Windows Build

Use the existing local build script when available, for example:

```powershell
npm run dist:all
```

Before building, stop running app processes:

```powershell
Get-Process | Where-Object { $_.ProcessName -like '*APP_NAME*' -or $_.ProcessName -like '*Helper*' } | Stop-Process -Force -ErrorAction SilentlyContinue
```

If the workspace is inside a sync folder or Windows locks generated EXE files, build to a temp output directory if the build script supports it. For projects using `electron-builder`, this can be passed with:

```powershell
$out = Join-Path $env:TEMP 'electron-build-output'
if (Test-Path $out) { Remove-Item -LiteralPath $out -Recurse -Force }
New-Item -ItemType Directory -Path $out | Out-Null
npx electron-builder --win portable nsis --publish never --config.directories.output="$out"
```

Verify final files:

```powershell
Get-ChildItem dist | Sort-Object LastWriteTime -Descending | Select-Object LastWriteTime,Length,Name
Get-AuthenticodeSignature -FilePath "dist\APP-INSTALLER.exe" | Format-List Status,SignatureType
```

If `NotSigned`, explain that Windows Smart App Control may block some machines until the app is signed with a trusted OV/EV code signing certificate and builds reputation.

## macOS Workflow Setup

Create or update `.github/workflows/build-macos.yml`.

Core workflow requirements:

- Run on push to `main` and `workflow_dispatch`.
- Use `runs-on: macos-latest`.
- Use Node matching the project.
- Run `npm ci`.
- Generate `.icns` from an existing PNG if the project lacks a macOS icon.
- Generate a macOS-specific electron-builder config so Windows-only files are excluded.
- Build both `--x64` and `--arm64`.
- Verify each DMG with `hdiutil verify`.
- Upload Actions artifacts.
- Publish direct DMG assets to a GitHub Release.

Template:

```yaml
name: Build macOS package

on:
  push:
    branches:
      - main
  workflow_dispatch:

permissions:
  contents: write

jobs:
  build-macos:
    name: Build macOS DMG
    runs-on: macos-latest
    env:
      CSC_IDENTITY_AUTO_DISCOVERY: "false"
      MAC_OUTPUT: dist-mac

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Create macOS icon
        shell: bash
        run: |
          set -euo pipefail
          mkdir -p build/mac/icon.iconset
          SOURCE_ICON="src/app-icon-256.png"
          sips -z 16 16 "$SOURCE_ICON" --out build/mac/icon.iconset/icon_16x16.png
          sips -z 32 32 "$SOURCE_ICON" --out build/mac/icon.iconset/icon_16x16@2x.png
          sips -z 32 32 "$SOURCE_ICON" --out build/mac/icon.iconset/icon_32x32.png
          sips -z 64 64 "$SOURCE_ICON" --out build/mac/icon.iconset/icon_32x32@2x.png
          sips -z 128 128 "$SOURCE_ICON" --out build/mac/icon.iconset/icon_128x128.png
          sips -z 256 256 "$SOURCE_ICON" --out build/mac/icon.iconset/icon_128x128@2x.png
          sips -z 256 256 "$SOURCE_ICON" --out build/mac/icon.iconset/icon_256x256.png
          sips -z 512 512 "$SOURCE_ICON" --out build/mac/icon.iconset/icon_256x256@2x.png
          sips -z 512 512 "$SOURCE_ICON" --out build/mac/icon.iconset/icon_512x512.png
          sips -z 1024 1024 "$SOURCE_ICON" --out build/mac/icon.iconset/icon_512x512@2x.png
          iconutil -c icns build/mac/icon.iconset -o build/mac/icon.icns

      - name: Create macOS builder config
        shell: bash
        run: |
          set -euo pipefail
          node <<'NODE'
          const fs = require('fs');
          const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
          const build = JSON.parse(JSON.stringify(pkg.build || {}));
          build.directories = { ...(build.directories || {}), output: process.env.MAC_OUTPUT || 'dist-mac' };
          build.files = [
            'index.html',
            'src/**/*',
            '!src/**/*.cs',
            '!src/**/*.exe',
            '!src/**/*.dll',
            'package.json',
          ];
          delete build.asarUnpack;
          delete build.extraResources;
          build.mac = {
            icon: 'build/mac/icon.icns',
            category: 'public.app-category.productivity',
            identity: '-',
            hardenedRuntime: false,
            gatekeeperAssess: false,
            target: ['dmg'],
            artifactName: 'APPNAME-${version}-${arch}.${ext}',
          };
          build.dmg = {
            artifactName: 'APPNAME-${version}-${arch}.dmg',
          };
          fs.writeFileSync('build/electron-builder.mac.generated.json', JSON.stringify(build, null, 2));
          NODE

      - name: Build macOS packages
        run: npx electron-builder --mac dmg --x64 --arm64 --publish never --config build/electron-builder.mac.generated.json

      - name: Verify macOS DMG packages
        shell: bash
        run: |
          set -euo pipefail
          for dmg in dist-mac/*.dmg; do
            hdiutil verify "$dmg"
          done

      - name: Upload macOS packages
        uses: actions/upload-artifact@v4
        with:
          name: app-macos-packages
          path: |
            dist-mac/*.dmg
            dist-mac/*.blockmap
          if-no-files-found: error

      - name: Publish direct DMG downloads
        uses: softprops/action-gh-release@v2
        with:
          tag_name: app-macos-latest
          target_commitish: main
          name: App macOS Latest
          body: |
            Download the DMG for your Mac chip.

            - Apple silicon M1/M2/M3/M4: APPNAME-VERSION-arm64.dmg
            - Intel Mac: APPNAME-VERSION-x64.dmg

            This build is ad-hoc signed but not notarized with Apple Developer ID.
          files: |
            dist-mac/*.dmg
          draft: false
          prerelease: false
          make_latest: true
```

Replace `APPNAME`, icon paths, files list, release tag, body, and version examples for the actual project.

## GitHub Publishing

If the repo is not on GitHub yet:

- Create or use a public/private GitHub repository.
- Add `origin`.
- Push `main`.
- Ensure Actions are enabled.

After push, check Actions:

```powershell
$repo='OWNER/REPO'
$runs=Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/actions/runs?per_page=5" -Headers @{ 'User-Agent'='codex' }
$runs.workflow_runs | Select-Object id,name,head_sha,status,conclusion,html_url,created_at | Format-List
```

Poll a run:

```powershell
$runId='RUN_ID'
for($i=0;$i -lt 45;$i++){
  $run=Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/actions/runs/$runId" -Headers @{ 'User-Agent'='codex' }
  Write-Output ("{0} status={1} conclusion={2}" -f (Get-Date -Format HH:mm:ss),$run.status,$run.conclusion)
  if($run.status -eq 'completed'){ break }
  Start-Sleep -Seconds 20
}
```

Check Release assets:

```powershell
$rel=Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases/tags/RELEASE_TAG" -Headers @{ 'User-Agent'='codex' }
$rel | Select-Object tag_name,name,html_url,published_at,updated_at,target_commitish | Format-List
$rel.assets | Select-Object name,size,updated_at,browser_download_url | Format-List
```

## macOS Install Guidance

Tell users:

- Apple silicon Macs use `arm64.dmg`.
- Intel Macs use `x64.dmg`.
- Download direct Release DMG files, not the zipped Actions artifact, unless debugging.

If macOS says the app is damaged or cannot be opened, explain this is usually Gatekeeper/quarantine behavior for an app without Apple Developer ID notarization.

Common workaround after dragging the app to `/Applications`:

```bash
sudo xattr -rd com.apple.quarantine "/Applications/APPNAME.app"
```

If the app still will not open, local ad-hoc signing can help:

```bash
codesign --force --deep --sign - "/Applications/APPNAME.app"
```

For a public release without these warnings, obtain an Apple Developer account, sign with Developer ID, and notarize the app.

## Windows Smart App Control Guidance

If Windows blocks the installer:

- Run `Get-AuthenticodeSignature` on the EXE.
- If unsigned, explain the block is expected on some Windows 11 configurations.
- Rebuilding alone cannot fully fix trust warnings.
- Keep `appId`, app name, and publisher identity stable to avoid reputation resets.
- For public distribution, use an OV or EV code signing certificate and configure electron-builder signing.

## Final Response Checklist

Report:

- Windows output paths if Windows packages were built.
- macOS GitHub Actions run URL.
- macOS Release URL and DMG names.
- Which DMG to use for Apple silicon vs Intel.
- Any remaining signing/notarization or Smart App Control caveats.
