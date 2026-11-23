---
name: package-electron-windows
description: Build and publish Windows desktop app packages, especially Electron apps, from a Windows workspace or GitHub Actions Windows runner. Use when the user asks to create Windows installer EXE, portable EXE, NSIS/electron-builder packages, upload Windows builds to GitHub Releases or repository download folders, troubleshoot Smart App Control warnings, unsigned EXE issues, locked generated EXE files, missing native helpers, or CI Windows packaging failures.
---

# Electron Windows Packaging

Use this skill to package Windows desktop applications, especially Electron projects using `electron-builder`, into installer and portable EXE artifacts and make them downloadable.

## First Checks

Inspect the project before editing:

```powershell
git status --short --branch
Get-Content package.json
rg -n "electron|electron-builder|appId|productName|artifactName|portable|nsis|win|asar|extraResources|asarUnpack" package.json .github src scripts -S
```

Confirm:

- the app is an Electron project or has a known Windows packaging system
- `package.json` has version, product name, app id, build config, and package scripts
- native helper files are present if referenced by `extraResources` or `asarUnpack`
- no unrelated temporary files are staged

## Versioning

If the user asks to rename or bump a visible version, update metadata instead of only renaming final files:

- root `package.json` `version`
- `build.productName`
- Windows `portable.artifactName`
- Windows `nsis.artifactName`
- in-app window titles and visible labels
- root package entries in `package-lock.json`

Keep `appId` stable unless the user intentionally wants a new app identity. Changing `appId` can reset Windows reputation, trigger Smart App Control, and affect app data identity.

## Local Windows Build

Run syntax checks first when the app is JavaScript/Electron:

```powershell
node --check src\main.js
```

Stop running app/helper processes before packaging:

```powershell
Get-Process | Where-Object { $_.ProcessName -like '*APP_NAME*' -or $_.ProcessName -like '*Helper*' } | Stop-Process -Force -ErrorAction SilentlyContinue
```

Use the project build script when available:

```powershell
npm run dist:all
```

For `electron-builder` projects without a project script:

```powershell
npx electron-builder --win portable nsis --publish never
```

If the workspace is in a sync folder or security software locks files, build to a temp output directory:

```powershell
$out = Join-Path $env:TEMP 'electron-windows-build'
if (Test-Path $out) { Remove-Item -LiteralPath $out -Recurse -Force }
New-Item -ItemType Directory -Path $out | Out-Null
npx electron-builder --win portable nsis --publish never --config.directories.output="$out"
```

Verify artifacts:

```powershell
Get-ChildItem dist | Sort-Object LastWriteTime -Descending | Select-Object LastWriteTime,Length,Name
Get-AuthenticodeSignature -FilePath "dist\APP-Setup.exe" | Format-List Status,SignatureType,SignerCertificate
```

## electron-builder Configuration

Typical Windows config:

```json
{
  "build": {
    "appId": "com.example.app",
    "productName": "App Name",
    "asar": true,
    "win": {
      "icon": "src/app-icon.ico",
      "target": ["portable", "nsis"]
    },
    "portable": {
      "unpackDirName": false,
      "artifactName": "AppName-${version}-Portable.exe"
    },
    "nsis": {
      "oneClick": false,
      "allowToChangeInstallationDirectory": true,
      "artifactName": "AppName-${version}-Setup.exe"
    }
  }
}
```

If the project uses a native helper:

- include required `.exe` files in `asarUnpack` or `extraResources`
- do not rely on ignored local generated files in CI unless they are rebuilt in CI
- if helper build is hard on CI, commit the helper intentionally or add a CI flag to skip helper compilation only when the helper exists

## Common Failure: EXE Locked

Symptoms:

- `EBUSY`, `EPERM`, `EACCES`, or `UNKNOWN` while opening generated app EXE
- failure during `addWinAsarIntegrity`
- failure during `editWindowsResources`

Actions:

1. Stop running app/helper processes.
2. Build to a temp output directory outside sync folders.
3. If failure is in ASAR integrity writing, set `build.disableAsarIntegrity: true`.
4. If failure is in `editWindowsResources`, security software may be locking the generated EXE. Add a local retry patch to `node_modules\app-builder-lib\out\util\resEdit.js` only as a build-machine workaround. Do not commit `node_modules`.

## Windows Smart App Control

If Windows says Smart App Control blocked the app:

- Check `Get-AuthenticodeSignature`.
- If `NotSigned`, explain this is expected for unsigned EXE files.
- Rebuilding alone cannot guarantee the warning disappears.
- Keep `appId`, product name, and publisher identity stable to avoid reputation resets.
- For public distribution, use a paid OV or EV code signing certificate and configure signing in the build.

Do not promise an unsigned installer will always run on all Windows 11 machines.

## GitHub Actions Windows Build

Add `.github/workflows/build-windows.yml` when cloud packaging or public downloads are needed.

Template:

```yaml
name: Build Windows package

on:
  push:
    branches:
      - main
  workflow_dispatch:

permissions:
  contents: write

jobs:
  build-windows:
    name: Build Windows installer and portable
    runs-on: windows-latest
    env:
      WINDOWS_OUTPUT: dist-win

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

      - name: Build Windows packages
        id: build
        continue-on-error: true
        shell: pwsh
        run: |
          npx electron-builder --win portable nsis --publish never --config.directories.output="$env:WINDOWS_OUTPUT" *>&1 | Tee-Object -FilePath windows-build-debug.log
          if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

      - name: Prepare release files
        if: steps.build.outcome == 'success'
        shell: pwsh
        run: |
          New-Item -ItemType Directory -Path release-win -Force | Out-Null
          $installer = Get-ChildItem $env:WINDOWS_OUTPUT -Filter '*Setup*.exe' | Select-Object -First 1
          $portable = Get-ChildItem $env:WINDOWS_OUTPUT -Filter '*Portable*.exe' | Select-Object -First 1
          if (-not $installer) { $installer = Get-ChildItem $env:WINDOWS_OUTPUT -Filter '*安装包.exe' | Select-Object -First 1 }
          if (-not $portable) { $portable = Get-ChildItem $env:WINDOWS_OUTPUT -Filter '*便携版.exe' | Select-Object -First 1 }
          if (-not $installer) { throw 'Windows installer EXE was not found.' }
          if (-not $portable) { throw 'Windows portable EXE was not found.' }
          Copy-Item -LiteralPath $installer.FullName -Destination 'release-win/App-Setup.exe' -Force
          Copy-Item -LiteralPath $portable.FullName -Destination 'release-win/App-Portable.exe' -Force
          Get-ChildItem release-win | Select-Object LastWriteTime,Length,Name | Format-Table -AutoSize
          Get-AuthenticodeSignature -FilePath 'release-win/App-Setup.exe' | Format-List Status,SignatureType

      - name: Upload Windows packages
        if: steps.build.outcome == 'success'
        uses: actions/upload-artifact@v4
        with:
          name: windows-packages
          path: release-win/*.exe
          if-no-files-found: error

      - name: Publish direct Windows downloads
        if: steps.build.outcome == 'success'
        uses: softprops/action-gh-release@v2
        with:
          tag_name: app-windows-latest
          target_commitish: main
          name: App Windows Latest
          body: |
            Windows:
            - Installer: App-Setup.exe
            - Portable: App-Portable.exe

            Note: Unsigned Windows builds may be blocked by Smart App Control on some PCs.
          files: release-win/*.exe
          overwrite_files: true
          draft: false
          prerelease: false
          make_latest: true

      - name: Publish Windows build debug log
        if: steps.build.outcome != 'success'
        uses: softprops/action-gh-release@v2
        with:
          tag_name: app-windows-latest
          target_commitish: main
          name: App Windows Latest
          files: windows-build-debug.log
          overwrite_files: true
          draft: false
          prerelease: false
          make_latest: true

      - name: Fail when Windows build failed
        if: steps.build.outcome != 'success'
        shell: pwsh
        run: exit 1
```

Prefer ASCII release asset names such as `App-Setup.exe` and `App-Portable.exe`; this avoids GitHub Actions/upload edge cases and makes links easier to share.

## GitHub Release or Repository Downloads

Preferred: GitHub Release assets.

If Release upload is blocked or the CLI is not authenticated, a fallback is to commit files under a download folder if each file is under GitHub's hard file limit:

```powershell
New-Item -ItemType Directory -Path downloads\windows\VERSION -Force | Out-Null
Copy-Item -LiteralPath "dist\App-Setup.exe" -Destination "downloads\windows\VERSION\App-Setup.exe" -Force
Copy-Item -LiteralPath "dist\App-Portable.exe" -Destination "downloads\windows\VERSION\App-Portable.exe" -Force
git add downloads/windows/VERSION
git commit -m "Add Windows VERSION downloads"
git push
```

This works but is less ideal than Release assets for large binaries. GitHub warns above 50 MB and rejects files above 100 MB unless using Git LFS.

## Debugging GitHub Actions

If public API logs are unavailable or rate-limited:

- publish `windows-build-debug.log` as a Release asset on failure
- inspect the debug log via the browser or direct download
- avoid excessive API polling

Common CI issues:

- missing native helper because `.gitignore` excluded generated `.exe`
- hardcoded `electronDist` path that exists locally but not on CI
- C# compiler path not available on `windows-latest`
- Release upload issues with non-ASCII filenames

## Final Response

Report:

- Windows installer path or download URL
- Windows portable path or download URL
- whether the files are signed
- any Smart App Control caveat
- GitHub Actions run URL if used
- whether files were uploaded as Release assets or repository downloads
