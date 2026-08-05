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
package metadata base.zip --message "Prepare handoff metadata"
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

### Step 5: generate the metadata files

Prefer the CLI instead of manually calculating hashes and structural changes:

```bash
# Use the original snapshot archive as the baseline.
package metadata /path/to/input.zip --message "Describe the delivered changes"

# Or, after extracting an archive that left its old manifest in the project root:
package metadata --message "Describe the delivered changes"
```

The command reads the baseline before replacing metadata, scans the current
project with `.packagerc` rules, and writes both `.packagemanifest.json` and
`.packageshift`. The short alias is `package meta`. If no baseline is supplied
and no existing manifest is present, it writes a current snapshot manifest and
an empty structural `.packageshift`.

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

### Step 6: verify the regenerated `.packagemanifest.json`

Never return a stale manifest copied from the input archive after source files
have changed. `package metadata` performs this regeneration automatically; an
agent should still inspect the result before packaging.

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
  "forceInclude": [],
  "forceIgnore": [],
  "packageManager": "npm",
  "packageManagerIgnore": false,
  "packageManagerIgnoreFile": ".npmignore",
  "beforePackage": [],
  "afterPackage": [],
  "beforeApply": [],
  "afterApply": [],
  "deletePackageOnApply": false,
  "deleteSourcePackageOnApply": false,
  "saveDeletedCache": true
}
```

`package init` also creates or updates `.gitignore` with a generated `*.zip`
rule so locally created package archives are not committed accidentally.

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

### Explicit multi-project composition

When an entry project's `.packagerc` contains `depends_on`, treat the archive as
one composed delivery made from several independently configured projects.

Example entry configuration in `codeissue/website/.packagerc`:

```json
{
  "depends_on": [
    {
      "path": "../backend",
      "name": "@codeissue/backend"
    }
  ]
}
```

Inspect the graph before packaging:

```bash
cd codeissue/website
package projects
package projects --json
```

Then use the normal commands from the entry project:

```bash
package zip
package shift website.zip --output update.zip
package apply update.zip --dry-run
package apply update.zip --yes
```

Important invariants for agents:

- do not flatten `website/**` and `backend/**`; archive paths stay relative to
  their shared parent directory;
- preserve every project's `.packagerc` unless the user explicitly requests a
  configuration change; Package carries discovered local config files even when
  an ordinary project ignore rule would omit them;
- collect each project with its own include/ignore, force, Git/package-manager,
  sensitive-file, mode, and mtime rules;
- read `manifest.composition` and preserve its entry project, project paths,
  names, and dependency edges throughout a snapshot/patch chain;
- do not silently add or remove a dependency from the graph while creating a
  patch; create a new base snapshot when the intended composition changes;
- run lifecycle hooks only through Package. Hooks execute dependency-first, with
  the owning project's directory as `cwd`;
- reject cycles, duplicate project names, missing project directories, roots on
  different volumes, filesystem-root-wide compositions, and path collisions.

The entry project owns archive-level policies such as output, compression,
conflict behavior, backups, and cleanup. Agents should run `apply` from the entry
project so those policies are loaded; Package itself resolves the shared target
root and updates all composed project directories.

`depends_on` and legacy workspace selection are intentionally mutually exclusive.
Use explicit composition when projects have their own `.packagerc` files and
must be delivered together.

### Legacy monorepo-scoped snapshots and patches

Before packaging a package-manager monorepo without `depends_on`, inspect
discovery and resolve the intended scope:

```bash
package workspaces
package workspaces @scope/api --json
```

Create a scoped snapshot by package name, root-relative workspace path, basename,
or glob. Add local graph expansion only when the requested deliverable needs it:

```bash
package zip --workspace @scope/api --with-dependencies
package zip -w apps/web -w packages/ui
package zip --all-workspaces --no-root-files
```

Workspace payload paths remain relative to the monorepo root. Root lockfiles and
shared configuration are controlled by `monorepo.shared` and
`includeRootFiles`.

The snapshot manifest stores `monorepo.root`, selected workspace names/paths, and
the root-file policy. `shift` and `metadata` inherit that scope and reject a
conflicting explicit selection with `WORKSPACE_SCOPE_MISMATCH`.

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
--allow-project-mismatch
--rewrite-all
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

### Cross-project protection

Before a real apply, the CLI evaluates whether the archive belongs to the target.
A verified patch base is treated as authoritative. Otherwise it compares
`package.json` names, embedded manifest project metadata, and whether archive
payload paths overlap the existing project structure.

When the archive appears to target another project, interactive apply prints both
identities and requires the operator to type the target directory name before the
normal apply confirmation. `--yes` does not suppress this extra guard. In a
non-interactive environment, the command fails with `PROJECT_MISMATCH` unless
`--allow-project-mismatch` is passed explicitly.

AI agents should follow this sequence:

```bash
package apply update.zip --cwd /path/to/target --dry-run
package inspect update.zip
# Only after confirming the target intentionally differs:
package apply update.zip --cwd /path/to/target --yes --allow-project-mismatch
```

Do not add `--allow-project-mismatch` automatically. Treat it as a user-approved
safety override, separate from `--force`. A dry run only warns and remains
non-destructive.

### Snapshot apply semantics

Applying a snapshot is an overlay. Files present in the archive are added or
updated. Files absent from the archive are not automatically deleted.

The default write policy is selective: Package hashes current payload files and
writes only additions, content changes, and mode changes. Unchanged files are not
opened for writing, keep their timestamps, and are excluded from apply backups
and deleted-file cache sessions.

Use `--rewrite-all` only when a full payload rewrite is intentional:

```bash
package apply snapshot.zip --rewrite-all
```

This flag rewrites every payload file even when its content and mode already
match. It does not delete extra target files; deletion still requires an explicit
`.packageshift` `REMOVE` instruction.

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
  "packageManager": "npm",
  "beforePackage": ["{packageManager} run typecheck"],
  "afterPackage": ["node scripts/report-package.mjs"],
  "beforeApply": ["{packageManager} run preapply"],
  "afterApply": ["{packageManager} install", "{packageManager} run build"]
}
```

Execution rules:

- commands run sequentially;
- in a single project, the working directory is that project root;
- in a `depends_on` composition, hooks run dependency-first and each command's
  working directory is the project that declared it;
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
PACKAGE_MANAGER
PACKAGE_PROJECT_NAME
PACKAGE_PROJECT_PATH
PACKAGE_COMPOSITION_ROOT
```

`packageManager` defaults to `npm`, but may name `pnpm`, `yarn`, `bun`, or any
other shell command. `{packageManager}` is replaced before a hook starts.

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

Interactive output distinguishes documentation from active operations. Help
output (`package -h`) uses only white and gray shades. Operational commands use
one consistent tree: `┌─` starts a section, `├─` and `└─` list details, and `┞─`
marks warnings and changes. Semantic colors help an agent or human scan results
quickly: green means successful work or additions, cyan/blue means information
or modifications, magenta means structural actions, yellow means caution or mode
changes, and red means removals or errors. Color is
automatically disabled when output is redirected or JSON is requested. Set
`NO_COLOR=1` to disable ANSI output explicitly.

## 19. Current limitations

AI agents should account for these implementation limits:

- ZIP64 and multi-disk ZIP archives are not supported.
- Individual ZIP entries are limited to 1 GiB.
- Expanded archives are limited to 4 GiB.
- Generated rename detection recognizes identical content.
- Snapshot application is an overlay, not directory synchronization.
- `--rewrite-all` rewrites payload files but still does not remove extra target
  files.
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
