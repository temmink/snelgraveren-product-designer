---
name: merge
description: Use when merging a feature branch or worktree back to main/master, cleaning up branches, or finishing isolated feature work. Also use when the user says "merge", "finish branch", or "land this".
disable-model-invocation: true
---

# Merge Feature Branch

Merge a feature branch (or worktree branch) into the main branch, run tests, and clean up.

## Critical Rule

**ALWAYS start by cd'ing to the main repository root.** Never run git merge, branch delete, or worktree remove from inside a worktree directory. If the shell is inside a worktree that gets deleted, every subsequent command will fail and recovery is impossible.

## Workflow

1. **Anchor to repo root**
   ```bash
   cd <REPO_ROOT> && pwd
   ```
   Verify output is the main repo, not a worktree path.

2. **Identify what to merge**
   ```bash
   git branch --list
   git worktree list
   ```
   If user didn't specify a branch, ask which one.

3. **Ensure clean state on main**
   ```bash
   git checkout main || git checkout master
   git status
   ```
   If uncommitted changes exist, stash them: `git stash push -m "pre-merge stash"`.

4. **Merge the feature branch**
   ```bash
   git merge <BRANCH_NAME>
   ```
   If conflicts arise, resolve them and confirm with the user before continuing.

5. **Run tests**
   Use the project's test runner. If tests fail, stop and diagnose before proceeding.

6. **Clean up worktree** (if one exists for this branch)
   ```bash
   git worktree remove <WORKTREE_PATH>
   ```
   If removal fails ("is dirty"), ask user whether to force (`--force`) or investigate.

7. **Delete the feature branch**
   ```bash
   git branch -d <BRANCH_NAME>
   ```
   Use `-d` (safe delete). Only use `-D` if the user explicitly confirms.

8. **Confirm final state**
   ```bash
   git log --oneline -5
   git worktree list
   git branch
   ```

## Recovery

If the shell gets stuck in a deleted directory:
```bash
cd / && cd <REPO_ROOT>
```

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Running merge from inside worktree | Always `cd` to repo root first |
| Force-deleting branch without asking | Use `-d`, confirm before `-D` |
| Forgetting to run tests after merge | Always test before cleanup |
| Deleting worktree while shell is in it | Anchor to repo root in step 1 |
