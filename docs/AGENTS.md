# AI agent guide for `@streetraceing/package`

This document is the operational contract for AI coding agents that create,
inspect, modify, or apply archives handled by `@streetraceing/package`.

Public URL: <https://streetraceing.github.io/package/AGENTS.md>

Use this guide when an AI system receives a project ZIP, changes source files,
and must return an archive that can be validated, reviewed, and applied by the
CLI.

## 1. What the tool is

`@streetraceing/package` is a dependency-free Node.js CLI for transporting
project source state safely.

It supports three related archive types:

- **Snapshot** — a complete selected project state created by `package zip`.
- **Patch** — only changed payload plus structural instructions, normally
  created by `package shift <base.zip>`.
- **Backup** — a private rollback delta created before destructive apply or
  restore operations.

The tool is not an npm package bundler and does not replace `npm pack`. It is a
project-source packaging, comparison, update, and rollback system.

Typical commands:

```bash
package zip
package shift base.zip --output update.zip
package check update.zip
package diff update.zip
package apply update.zip --dry-run
package apply update.zip
```

The same CLI can be used without global installation:

```bash
npx @streetraceing/package zip
npx @streetraceing/package apply update.zip
```

## 2. The core AI-agent workflow

When an AI agent receives a source archive and must return modified source code,
follow this sequence.

### Step 1: inspect the archive before editing

Confirm that the archive contains project files and inspect these metadata files
when present:

```text
.packagemanifest.json
.packageshift
.packagerc
```

Run:

```bash
package check input.zip
package inspect input.zip
package list input.zip
```

Do not assume that `.packageshift` is project source. It is CLI metadata and an
instruction file.

### Step 2: extract into an isolated workspace

Extract the archive into a clean temporary directory. Never edit directly inside
an existing unrelated repository.

Preserve:

- every input file that the user did not ask to remove;
- path spelling and case;
- executable modes where the platform supports them;
- line endings unless a formatter intentionally changes them;
- the existing `.packagerc` unless the user explicitly asks to modify it.

Do not add generated dependencies, caches, `.git`, local backups, or temporary
build output unless the task explicitly requires them.

### Step 3: make only requested source changes

Follow project-local instructions such as `AGENTS.md`, contributing guides,
formatter settings, tests, and build scripts.

Prefer minimal edits over broad rewrites. Do not change the project structure
merely to make packaging easier.

### Step 4: validate the project

Use the project's own verification commands. Common examples:

```bash
npm run typecheck
npm test
npm run build
```

The exact commands come from the project, not from this guide.

### Step 5: create or update `.packageshift`

The output archive for an AI-delivered change set should contain a valid
`.packageshift`, even when the only operations are payload additions or
replacements.

At minimum:

```text
PACKAGESHIFT 1
MESSAGE "Describe the delivered changes"
```

Add explicit structural operations for removals, moves, copies, guarded
replacements, and mode changes.

Example:

```text
PACKAGESHIFT 1
MESSAGE "Add unified menu handling and remove the obsolete view"
BASE sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef

REMOVE "src/bot/legacy-menu.ts" IF sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
MOVE "src/bot/menu-old.ts" TO "src/bot/menu.ts" IF sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
REPLACE "src/bot/handlers.ts" IF sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc
CHMOD "scripts/deploy.sh" 755
```

Use forward slashes in archive paths on every operating system.

### Step 6: regenerate `.packagemanifest.json`

Never return a stale manifest copied from the input archive after source files
have changed.

The manifest must describe the output archive's actual payload, including:

- current paths;
- exact byte sizes;
- Unix modes;
- SHA-256 values;
- a recomputed root hash.

Example shape:

```json
{
  "schemaVersion": 1,
  "kind": "snapshot",
  "project": "example-project",
  "createdAt": "2026-07-31T00:00:00.000Z",
  "rootHash": "sha256:...",
  "config": {
    "strategy": "git",
    "gitignore": true,
    "npmignore": false,
    "dot": true
  },
  "files": [
    {
      "path": "src/index.ts",
      "size": 143,
      "mode": 438,
      "sha256": "sha256:..."
    }
  ]
}
```

`.packagemanifest.json`, `.packagemanifest`, and `.packageshift` are reserved
metadata and must not appear in `manifest.files` as project payload.

### Step 7: build the final ZIP

The output archive must include all retained project files plus the refreshed
metadata.

Required for the AI handoff workflow:

```text
.packagemanifest.json
.packageshift
```

The archive should not contain an extra top-level wrapper directory unless the
input format or user explicitly requires one.

### Step 8: validate the returned archive

Before returning it, run:

```bash
package check output.zip
package inspect output.zip
```

For update archives, also run:

```bash
package diff output.zip --cwd /path/to/base-project
package apply output.zip --cwd /path/to/base-project --dry-run
```

The final answer to the user should identify the archive, summarize changes, and
include a concise Git commit message.

## 3. Archive metadata rules

### `.packagemanifest.json`

This file is generated metadata. It is used for integrity checks, comparison,
base verification, source-snapshot identification, and safe application.

Rules for AI agents:

1. Do not treat it as application source.
2. Do not edit individual hashes manually without recomputing all metadata.
3. Do not include it in its own `files` array.
4. Keep `schemaVersion` at a supported value.
5. Use SHA-256 strings prefixed with `sha256:`.
6. Ensure every listed payload file actually exists in the ZIP.
7. Ensure payload files that should be applied are listed in the manifest.

A patch manifest may additionally contain:

```json
{
  "kind": "patch",
  "baseRootHash": "sha256:...",
  "baseFiles": [],
  "sourcePackage": {
    "name": "base.zip",
    "sha256": "sha256:..."
  }
}
```

`sourcePackage` lets `deleteSourcePackageOnApply` safely identify the snapshot
used to generate the patch. It records a filename and hash, not an absolute path.

### `.packageshift`

`.packageshift` is parsed by the CLI and is never copied into the target project.
It is not a source file, configuration file, or payload file.

The first non-comment instruction must be:

```text
PACKAGESHIFT 1
```

Supported instructions:

```text
MESSAGE "Description"
BASE sha256:<64-hex-hash>
REMOVE "path" [IF sha256:<hash>]
MOVE "source" TO "destination" [IF sha256:<hash>]
COPY "source" TO "destination"
REPLACE "path" [IF sha256:<hash>]
CHMOD "path" <octal-mode>
```

Use `IF sha256:` guards for destructive operations whenever the base content is
known. A guard prevents silently deleting or replacing a locally changed file.

Reserved paths may not be targeted:

```text
.packageshift
.packagemanifest.json
.packagemanifest
```

See the full format reference:
<https://streetraceing.github.io/package/PACKAGESHIFT.md>

### `.packagerc`

`.packagerc` is strict JSON. It does not allow comments, single-quoted strings,
unquoted keys, or trailing commas.

Schema URL:
<https://streetraceing.github.io/package/schema.json>

Example:

```json
{
  "$schema": "https://streetraceing.github.io/package/schema.json",
  "strategy": "git",
  "gitignore": true,
  "dot": true,
  "ignore": ["coverage/**"],
  "beforePackage": [],
  "afterPackage": [],
  "beforeApply": [],
  "afterApply": [],
  "deletePackageOnApply": false,
  "deleteSourcePackageOnApply": false,
  "saveDeletedCache": true
}
```

Unless the user specifically requests a configuration change, preserve the
existing `.packagerc` exactly. AI agents should not silently enable cleanup,
force overwrite behavior, disable backups, or add shell hooks.

## 4. Snapshot and patch workflows

### Create a snapshot

```bash
package zip
```

With an explicit output:

```bash
package zip --output project-base.zip
```

The snapshot contains the selected project files and a generated manifest.
File selection uses Git when possible:

```text
git ls-files --cached --others --exclude-standard
```

If Git is unavailable or `strategy` is `walk`, the CLI uses its own ignore-aware
walker.

Always excluded from ordinary source payload are Git metadata, dependencies,
backup/cache directories, generated package metadata, and the output archive
itself.

### Create a patch from a snapshot

After changing the project:

```bash
package shift project-base.zip --output project-update.zip \
  --message "Implement the requested update"
```

A generated patch contains:

- added and modified payload files;
- `.packagemanifest.json` with base metadata;
- `.packageshift` for removals, moves, replacements, and mode changes.

### Manually assembled update archive

The CLI accepts a ZIP containing payload and `.packageshift` without an embedded
manifest. This is useful for interoperability, but base-project verification is
limited.

The CLI prints a warning and derives temporary file metadata from ZIP entries.
AI agents should prefer a real generated manifest whenever possible.

## 5. Review before applying

Never apply an untrusted archive blindly.

Validate syntax and integrity:

```bash
package check update.zip
```

Inspect metadata:

```bash
package inspect update.zip
package inspect update.zip --json
```

Preview differences:

```bash
package diff update.zip
package apply update.zip --dry-run
```

Machine-readable output is available where documented:

```bash
package diff update.zip --json
package list update.zip --json
```

## 6. Applying updates safely

Interactive apply:

```bash
package apply update.zip
```

Non-interactive apply after prior review:

```bash
package apply update.zip --yes
```

Important options:

```text
--dry-run
--yes
--force
--backup / --no-backup
--conflict abort|overwrite|skip
--delete-package / --keep-package
--delete-source-package / --keep-source-package
--save-deleted-cache / --no-save-deleted-cache
```

### Conflict strategies

- `abort` — safest default; stop before changes are written.
- `overwrite` — replace conflicting local content.
- `skip` — keep conflicting local paths and apply the remaining operations.

`--force` bypasses base and per-file hash guards. An AI agent should not use it
unless the user explicitly accepts the risk or the agent has independently
verified the target state.

### Snapshot apply semantics

Applying a snapshot is an overlay. Files present in the archive are added or
replaced. Files absent from the archive are not automatically deleted.

Deletion requires an explicit `.packageshift` `REMOVE` instruction.

### Transaction and rollback behavior

The CLI validates the archive before writing. With backups enabled, it records
the affected pre-apply state. If the file transaction fails, it attempts to roll
back partial changes.

`beforeApply` is strict and runs before file changes. If it fails, apply stops.

`afterApply` is best-effort and runs after successful file changes. If a command
fails, the CLI prints a warning, continues later `afterApply` commands, keeps the
applied files, and proceeds with configured cleanup.

## 7. Lifecycle hooks

Hooks may be one shell command string or an array of commands.

```json
{
  "beforePackage": ["npm run typecheck"],
  "afterPackage": ["node scripts/report-package.mjs"],
  "beforeApply": ["npm run preapply"],
  "afterApply": ["npm install", "npm run build"]
}
```

Execution rules:

- commands run sequentially;
- working directory is the project root;
- `beforePackage` and `afterPackage` wrap `zip` and `shift`;
- `beforeApply` runs after validation and confirmation, before writes;
- `afterApply` runs after successful writes;
- hooks do not run for `--dry-run`;
- empty arrays preserve default behavior and run nothing.

Available environment variables:

```text
PACKAGE_HOOK
PACKAGE_COMMAND
PACKAGE_ROOT
PACKAGE_ARCHIVE
```

Security rule for AI agents: do not add or modify hooks without explicit user
approval. Hooks execute arbitrary shell commands.

## 8. Package cleanup options

Both cleanup options are disabled by default.

```json
{
  "deletePackageOnApply": false,
  "deleteSourcePackageOnApply": false
}
```

### `deletePackageOnApply`

After a successful apply lifecycle, the CLI may delete the archive that was just
applied.

An absolute external path can therefore be deleted when this setting or the
`--delete-package` flag is enabled.

### `deleteSourcePackageOnApply`

For a generated patch, the CLI first uses the source snapshot filename and
SHA-256 stored in the patch manifest.

It searches:

1. beside the applied update archive;
2. in the target project root.

If explicit source metadata is unavailable, it may safely identify exactly one
snapshot whose manifest matches the project state before apply. Ambiguous,
changed, missing, or symbolic-link candidates are preserved.

AI agents should keep both cleanup settings `false` unless the user asks for
automatic deletion.

## 9. Deleted-file cache

`saveDeletedCache` defaults to `true`.

Before the CLI removes or replaces a regular file, it saves the previous content
under the user's data directory:

```text
~/streetraceing/.package/cache/<project-id>/<operation-id>
```

On Windows:

```text
%USERPROFILE%\streetraceing\.package\cache\<project-id>\<operation-id>
```

Each operation includes `.packagecache.json` with original paths, cached paths,
reasons, sizes, modes, and SHA-256 values.

The cache covers CLI-managed destructive operations such as:

- apply replacements and removals;
- backup restore changes;
- replacing an existing output ZIP;
- `init --force`;
- applied-package cleanup;
- source-snapshot cleanup.

Files larger than 10 MiB are still cached, but the CLI prints an explicit warning
before continuing.

Commands executed inside hooks are separate processes. The CLI cannot intercept
or cache files deleted by arbitrary hook scripts.

## 10. Versioned backups

Apply backups are stored outside the project:

```text
~/streetraceing/.package/backups/<project-id>
```

On Windows the root is below `%USERPROFILE%`.

Commands:

```bash
package backup list
package backup inspect 1
package backup inspect 1 --json
package backup restore latest
package backup restore 3 --yes
```

A restore creates a recovery backup of the current state first. It then applies
the selected rollback version and every newer delta in reverse order. The
recovery version can later undo the rollback.

Set `STREETRACEING_PACKAGE_HOME` to isolate or relocate package-managed storage:

```bash
STREETRACEING_PACKAGE_HOME=/tmp/package-data package backup list
```

PowerShell:

```powershell
$env:STREETRACEING_PACKAGE_HOME = "C:\Temp\package-data"
package backup list
```

## 11. Sensitive files and secrets

Packaging source may accidentally include secrets. Review at least:

```text
.env
.env.*
*.pem
*.key
id_rsa
.npmrc
service-account*.json
```

The `sensitiveFiles` configuration supports `warn`, `error`, or `allow`.

AI agents must never invent, expose, or preserve real secrets merely to make an
archive complete. When a secret-looking file is present, follow the user's
security requirements and prefer placeholders such as `.env.example`.

## 12. Cross-platform path rules

Archive and `.packageshift` paths always use `/` separators:

```text
src/api/client.ts
```

Do not use:

```text
C:\project\src\api\client.ts
/src/api/client.ts
../outside.txt
```

The CLI rejects absolute paths, drive-prefixed paths, NUL bytes, traversal, and
unsafe symbolic-link boundaries.

When showing shell examples, account for platform quoting:

```powershell
package apply "C:\Users\name\Downloads\update.zip"
```

```bash
package apply "/home/name/Downloads/update.zip"
```

## 13. Deterministic and reproducible archives

With default configuration:

```json
{
  "deterministic": true,
  "preserveMode": true,
  "preserveMtime": false,
  "compressionLevel": 9
}
```

Deterministic archives stabilize metadata so equivalent payloads produce
repeatable package content. File hashes and root hashes remain the authoritative
integrity values.

An AI agent should not disable deterministic behavior without a specific reason.

## 14. What an AI agent must not do

Do not:

- copy `.packageshift` into the target project;
- list reserved metadata as payload in `manifest.files`;
- return a stale `.packagemanifest.json`;
- omit files from the input archive without an explicit requested removal;
- modify `.packagerc` without user approval;
- enable deletion, force, overwrite, or hooks silently;
- include `.git`, `node_modules`, local backup/cache directories, or temporary
  workspace files;
- use absolute paths inside `.packageshift`;
- claim validation passed when commands were not run;
- hide failed tests or warnings from the user.

## 15. Recommended AI handoff checklist

Before returning an archive, verify all of the following:

- [ ] The requested changes are complete.
- [ ] Unrelated project structure was not changed.
- [ ] Every retained input file is present.
- [ ] Intentional removals are represented in `.packageshift`.
- [ ] `.packagerc` is unchanged unless requested.
- [ ] `.packageshift` starts with `PACKAGESHIFT 1`.
- [ ] `.packageshift` is not listed as payload.
- [ ] `.packagemanifest.json` matches actual archive contents.
- [ ] Root hash and file SHA-256 values were recomputed.
- [ ] Project tests/build/typecheck were run where available.
- [ ] `package check` succeeds on the output ZIP.
- [ ] `package apply --dry-run` was used when a base project was available.
- [ ] The final response includes the ZIP and a short Git commit message.

## 16. Complete example: AI modifies a snapshot

Assume the agent receives `website-base.zip` and must add a health endpoint,
modify the application entry point, and remove an obsolete module.

Extract and edit:

```bash
mkdir work
cd work
unzip ../website-base.zip
# Edit files here.
```

Create `.packageshift`:

```text
PACKAGESHIFT 1
MESSAGE "Add health endpoint and remove obsolete status module"

REMOVE "src/status-old.ts" IF sha256:1111111111111111111111111111111111111111111111111111111111111111
REPLACE "src/index.ts" IF sha256:2222222222222222222222222222222222222222222222222222222222222222
```

The new payload contains:

```text
src/index.ts
src/api/health.ts
```

Regenerate `.packagemanifest.json`, create `website-update.zip`, then verify:

```bash
package check website-update.zip
package diff website-update.zip --cwd ../website-base-project
package apply website-update.zip --cwd ../website-base-project --dry-run
```

Expected review output should identify:

```text
MODIFY src/index.ts
ADD    src/api/health.ts
REMOVE src/status-old.ts
```

Return the archive with a concise summary and commit message, for example:

```text
feat: add health endpoint and remove obsolete status module
```

## 17. Complete example: native CLI workflow

The safest way to generate metadata is to let the CLI do it.

Create the base snapshot:

```bash
package zip --output project-base.zip
```

Change the project, then create the patch:

```bash
package shift project-base.zip \
  --output project-update.zip \
  --message "Implement requested project changes"
```

Review and apply:

```bash
package check project-update.zip
package diff project-update.zip
package apply project-update.zip --dry-run
package apply project-update.zip
```

This workflow automatically generates file hashes, base metadata, source-package
identity, and `.packageshift` operations.

## 18. Exit behavior and automation

For CI or agent automation:

- use `--json` when structured output is supported;
- use `--dry-run` before a destructive command;
- use `--yes` only after review;
- keep `conflictStrategy` at `abort` unless a different strategy is intentional;
- treat `beforeApply` failure as a blocked apply;
- treat `afterApply` warnings as post-apply task failures, not failed file
  application;
- inspect terminal warnings even when the command exit status is successful.

Color is automatically disabled when output is redirected or JSON is requested.
Set `NO_COLOR=1` to disable ANSI output explicitly.

## 19. Current limitations

AI agents should account for these implementation limits:

- ZIP64 and multi-disk ZIP archives are not supported.
- Individual ZIP entries are limited to 1 GiB.
- Expanded archives are limited to 4 GiB.
- Generated rename detection recognizes identical content.
- Snapshot application is an overlay, not directory synchronization.
- A manifestless update cannot fully verify the base project.
- Git is more authoritative than the fallback walker for complex ignore rules.
- Hook-created deletions cannot be captured by the deleted-file cache.

## 20. Authoritative references

- Main documentation: <https://streetraceing.github.io/package/>
- AI agent guide: <https://streetraceing.github.io/package/AGENTS.md>
- Configuration schema: <https://streetraceing.github.io/package/schema.json>
- `.packageshift` reference:
  <https://streetraceing.github.io/package/PACKAGESHIFT.md>
- npm package: `@streetraceing/package`

When this guide and project-local instructions differ, follow the more specific
project-local instruction unless it would make the archive invalid or unsafe.
When uncertain, preserve data, avoid destructive options, run `package check`,
and ask the user before enabling cleanup, force, overwrite, or shell hooks.
