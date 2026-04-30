# macOS Signing & Notarization Setup

Signing prevents the "damaged app" Gatekeeper error. Notarization is Apple's
malware scan — both are required for a clean install experience.

---

## Prerequisites

- Apple Developer account active (developer.apple.com, $99/year)
- Access to the GitHub repo secrets (Settings → Secrets and variables → Actions)
- macOS machine with Keychain access

---

## Step 1 — Create a Developer ID Certificate

1. Go to [developer.apple.com/account/resources/certificates](https://developer.apple.com/account/resources/certificates)
2. Click **+** to create a new certificate
3. Choose **Developer ID Application** (not Mac App Store)
4. Follow the prompts to generate a CSR from your Mac (Keychain Access → Certificate Assistant)
5. Download the `.cer` file and double-click to install it into your Keychain

Verify it's installed:
```bash
security find-identity -v -p codesigning
```
You should see a line like:
```
"Developer ID Application: Your Name (XXXXXXXXXX)"
```
Note your **Team ID** — the 10-character code in parentheses.

---

## Step 2 — Export the Certificate as a .p12

1. Open **Keychain Access** → My Certificates
2. Find **Developer ID Application: Your Name**
3. Right-click → **Export** → save as `certificate.p12`
4. Set a strong password when prompted — you'll need it for the CI secret

Base64-encode it for GitHub:
```bash
base64 -i certificate.p12 | pbcopy
```
This copies the encoded string to your clipboard.

---

## Step 3 — Create an App-Specific Password

1. Go to [appleid.apple.com](https://appleid.apple.com) → Sign-In and Security → **App-Specific Passwords**
2. Click **+**, name it "Limina CI"
3. Copy the generated password — **you only see it once**

---

## Step 4 — Generate a MusicKit Key (while you're here)

1. Go to [developer.apple.com/account/resources/authkeys](https://developer.apple.com/account/resources/authkeys)
2. Click **+**, name it "Limina MusicKit", enable **MusicKit**
3. Download the `.p8` file — **only downloadable once, store it safely**
4. Note the **Key ID** shown on the page

You'll need this later when integrating the Apple Music API.

---

## Step 5 — Add Secrets to GitHub

Go to your repo → **Settings → Secrets and variables → Actions → New repository secret**

| Secret name | Value |
|---|---|
| `APPLE_ID` | Your Apple ID email address |
| `APPLE_APP_SPECIFIC_PASSWORD` | Password from Step 3 |
| `APPLE_TEAM_ID` | 10-char Team ID from Step 1 |
| `CSC_LINK` | Base64 string from Step 2 |
| `CSC_KEY_PASSWORD` | Password you set when exporting the .p12 |

---

## Step 6 — Update the Codebase

Once secrets are in place, update three files:

### `build/entitlements.mac.plist` (create this file)

Required for Electron's hardened runtime:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-jit</key><true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/>
  <key>com.apple.security.cs.disable-library-validation</key><true/>
</dict>
</plist>
```

### `electron-builder.yml` — remove `identity: null`, add notarize config

```yaml
mac:
  target:
    - target: dmg
      arch: [arm64, x64]
  hardenedRuntime: true
  gatekeeperAssess: false
  entitlements: build/entitlements.mac.plist
  entitlementsInherit: build/entitlements.mac.plist
  notarize:
    teamId: YOUR_TEAM_ID
```

### `.github/workflows/release.yml` — add env vars, remove identity bypass

```yaml
env:
  APPLE_ID: ${{ secrets.APPLE_ID }}
  APPLE_APP_SPECIFIC_PASSWORD: ${{ secrets.APPLE_APP_SPECIFIC_PASSWORD }}
  APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
  CSC_LINK: ${{ secrets.CSC_LINK }}
  CSC_KEY_PASSWORD: ${{ secrets.CSC_KEY_PASSWORD }}
  GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
  # Remove CSC_IDENTITY_AUTO_DISCOVERY: false
```

> **Note:** Claude Code can make all three of these code changes — just say "set up signing" once secrets are added.

---

## What to Expect

- Build time increases by ~3–5 minutes — notarization uploads the binary to Apple's servers for scanning
- The resulting DMG installs without any Gatekeeper warning
- Users on both Apple Silicon and Intel will get a native binary (universal build)

---

## Troubleshooting

**"No identity found"** — the certificate isn't in the CI keychain. Check `CSC_LINK` is the full base64 string with no line breaks.

**Notarization timeout** — Apple's servers are occasionally slow. electron-builder retries automatically; if it fails, re-run the CI job.

**"Team ID not found"** — double-check `APPLE_TEAM_ID` matches the 10-char code in your certificate (`security find-identity -v -p codesigning`).
