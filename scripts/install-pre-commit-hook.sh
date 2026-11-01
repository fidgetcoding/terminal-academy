#!/usr/bin/env bash
# install-pre-commit-hook.sh — wires up the local gitleaks pre-commit hook.
# Idempotent: safe to re-run.
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
HOOK="$REPO_ROOT/.git/hooks/pre-commit"

if ! command -v gitleaks &>/dev/null; then
  echo "❌ gitleaks not found on PATH — pre-commit hook NOT installed." >&2
  echo "   Install gitleaks, then re-run this script:" >&2
  echo "   macOS:  brew install gitleaks" >&2
  echo "   Linux:  sudo apt install gitleaks   (Ubuntu 24.04+)" >&2
  echo "           or grab a release: https://github.com/gitleaks/gitleaks/releases" >&2
  exit 1
fi

mkdir -p "$REPO_ROOT/.git/hooks"
# Keep a hook that isn't ours rather than overwriting it.
if [ -e "$HOOK" ] && ! grep -q 'gitleaks scan on staged content' "$HOOK"; then
  mv "$HOOK" "$HOOK.bak"
  echo "⚠️  Existing pre-commit hook saved as $HOOK.bak. It will not run until you merge it back." >&2
fi
cat > "$HOOK" <<'HOOK_EOF'
#!/usr/bin/env bash
# pre-commit — gitleaks scan on staged content. Block if any secret detected.
# Bypass for emergencies: git commit --no-verify
set -euo pipefail

if ! command -v gitleaks &>/dev/null; then
  echo "🚨 gitleaks is not installed, so this commit can't be scanned for secrets. Commit BLOCKED." >&2
  echo "   Install it (macOS: brew install gitleaks), or bypass with: git commit --no-verify" >&2
  exit 1
fi

if ! gitleaks protect --staged --no-banner --redact -v 2>&1; then
  echo ""
  echo "🚨 SECRETS DETECTED in staged content. Commit BLOCKED." >&2
  echo "   1. Review the leak above (output redacted)." >&2
  echo "   2. Remove the secret from your changes." >&2
  echo "   3. Re-stage cleaned files and commit again." >&2
  echo "   4. Emergency bypass (DO NOT USE FOR REAL SECRETS): git commit --no-verify" >&2
  exit 1
fi
HOOK_EOF
chmod +x "$HOOK"

echo "✅ Installed pre-commit hook → $HOOK"
