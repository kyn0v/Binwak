# 🤖 Copilot Auto-Fix Dependencies Guide

## 🔄 Automation Workflow Overview

This repository has a three-tier automation system to handle dependency vulnerabilities:

### 1️⃣ **Auto Detection (security-audit.yml)**
- **Trigger**: Runs automatically every Monday at 09:00 UTC, or manually triggered
- **Behavior**: Runs `npm audit` on `client/`, `server/`, and `admin/` directories
- **Creates Issue**: Automatically creates an issue when HIGH or CRITICAL vulnerabilities are found

### 2️⃣ **Auto Labeling (assign-copilot.yml)**
- **Trigger**: When issue is created or label is added
- **Behavior**: Automatically adds `copilot` label to security vulnerability issues
- **Assignment**: Copilot agent can auto-recognize and claim the task

### 3️⃣ **Auto Merge (dependabot.yml)**
- **Dependabot**: Automatically creates dependency update PRs (weekly)
- **Patch Versions**: Security patches auto-merge (if configured)

---

## 📋 Workflow

### Scenario A: Auto-detected Vulnerability

```
1. Every Monday: security-audit.yml runs
   ↓
2. Finds HIGH/CRITICAL vulnerability
   ↓
3. Auto-creates issue with 'security', 'dependencies' labels
   ↓
4. assign-copilot.yml adds 'copilot' label + comment
   ↓
5. [Optional] GitHub Copilot agent auto-claims and creates PR
   ↓
6. When PR merges, issue auto-closes
```

### Scenario B: Dependabot-detected Vulnerability

```
1. GitHub Dependabot checks weekly
   ↓
2. Creates dependency update PR
   ↓
3. If patch version → auto-merge
   ↓
4. If major version → requires manual review + Copilot assistance
```

---

## 🎯 How to Use Copilot for Manual Fixes

### Method 1: Via GitHub Issue

```bash
# Comment on GitHub issue:
/ask @GitHub-Copilot Fix this dependency vulnerability, create a PR with all necessary updates
```

### Method 2: In VS Code

```bash
# 1. Create issue using Copilot CLI
gh issue create \
  --title "fix(deps): Fix vulnerabilities in client/" \
  --label security,dependencies

# 2. Get issue number, then assign to Copilot
gh copilot issue-fix <issue_number>
```

### Method 3: Direct PR Creation

```bash
# 1. Create fix branch
git checkout -b fix/deps-security

# 2. Run audit fix
cd client
npm audit fix  # Auto-fix

# 3. Verify
npm ci
npm run test
npm run build

# 4. Push PR
git push origin fix/deps-security
```

---

## 🔍 Verification Checklist

When fixing vulnerabilities, verify these items:

```
- [ ] Local `npm ci --prefix <dir>` succeeds
- [ ] All unit tests pass (`npm run test`)
- [ ] Type checking passes (`vue-tsc --noEmit`)
- [ ] Production builds succeed
  - [ ] `npm run build:mp-weixin`
  - [ ] `npm run build:h5`
- [ ] No new TypeScript errors
- [ ] Dependency tree is clean (no circular deps)
```

---

## 📊 Configuration Details

### security-audit.yml

```yaml
schedule:
  - cron: '0 9 * * 1'  # Every Monday at 09:00 UTC
```

Customize the schedule by editing the cron expression:
- `0 9 * * 1` = Every Monday 09:00 UTC
- `0 */12 * * *` = Every 12 hours
- Learn more: https://crontab.guru/

### dependabot.yml

```yaml
auto-merge:
  allow-conditions:
    - update-type: "patch"      # Only patch versions auto-merge
```

Auto-merge conditions:
- Only patch versions (`x.y.Z`) auto-merge
- Major/minor version updates require manual review

---

## 🚀 Best Practices

### ✅ Recommended

1. **Use Copilot agent**:
   ```
   Comment on issue: /ask @GitHub-Copilot Create PR to fix
   ```

2. **Set branch protection**:
   - ✅ All CI/CD must pass
   - ✅ Code review must pass
   - ✅ No conflicts

3. **Regular review**:
   - Check `npm audit` results monthly
   - Monitor Dependabot PR updates

### ❌ Avoid

- ❌ Manual `npm install` (use `npm ci`)
- ❌ Commit without tests
- ❌ Ignore peer dependency warnings
- ❌ Mix multiple version updates in one PR (hard to rollback)

---

## 📱 Monitoring Issues

### View all security issues

```bash
# See open security issues
gh issue list --label security,dependencies --state open

# Check latest audit results
gh workflow view security-audit.yml
```

### Manually run audit

```bash
# Run security audit immediately
gh workflow run security-audit.yml
```

---

## 🔗 Related Resources

- [Dependabot Documentation](https://docs.github.com/en/code-security/dependabot)
- [npm audit Guide](https://docs.npmjs.com/cli/v8/commands/npm-audit)
- [GitHub Actions Documentation](https://docs.github.com/en/actions)

---

## ❓ FAQ

### Q: Why wasn't an issue created for a vulnerability?
A: The workflow only auto-creates issues for HIGH or CRITICAL severity. MODERATE and LOW require manual handling.

### Q: What's the difference between Dependabot and security-audit?
A: 
- **Dependabot**: GitHub's official tool, checks for latest package versions
- **security-audit**: Custom workflow, focused on high-risk vulnerabilities with assignable issues

### Q: Can I disable auto-merge?
A: Yes, comment out the `auto-merge` section in `dependabot.yml`.

### Q: How do I rollback a failed fix?
A: Each PR can be independently reverted using `git revert` or by reopening the issue.

