# @streetraceing/package

[![npm version](https://img.shields.io/npm/v/%40streetraceing/package?logo=npm&label=npm)](https://www.npmjs.com/package/@streetraceing/package)
[![Node.js version](https://img.shields.io/node/v/%40streetraceing/package?logo=node.js&label=node)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Package is a dependency-free TypeScript command-line tool for creating project
source archives, generating update packages, and safely applying them to another
copy of a project.

- clean ZIP snapshots with SHA-256 file hashes, Unix modes, and package metadata;
- incremental update archives with additions, replacements, removals, moves, and
  permission changes;
- comparison and dry-run support before an update is applied;
- selective apply writes only added, modified, or mode-changed files by default;
- path, archive-integrity, base-project, and per-file conflict checks, with
  versioned backups, rollback history, recovery backups, and a deleted-file cache;
- explicit multi-project composition through local `depends_on` declarations, with
  per-project file rules and lifecycle hooks;
- legacy monorepo workspace discovery, dependency-aware scoping, and safe
  workspace patch inheritance;
- readable colorized terminal output with automatic plain-text fallback.

Requires Node.js 18 or later.

## Install and use

Run the CLI without a global installation:

```bash
npx @streetraceing/package zip
```

Or install it globally to use the `package` command directly:

```bash
npm install --global @streetraceing/package
package zip
```

Create a snapshot, generate an update from it after changing the project, then
inspect or apply that update:

```bash
npx @streetraceing/package zip
npx @streetraceing/package shift base.zip --output update.zip
npx @streetraceing/package diff update.zip
npx @streetraceing/package apply update.zip --dry-run
npx @streetraceing/package apply update.zip --yes
```

Common options:

```bash
npx @streetraceing/package zip --output release.zip
npx @streetraceing/package zip --cwd /path/to/project --strategy=walk
npx @streetraceing/package shift base.zip --message "Describe the update"
npx @streetraceing/package metadata base.zip --message "Prepare metadata files"
npx @streetraceing/package apply update.zip --conflict=skip
npx @streetraceing/package apply snapshot.zip --rewrite-all
npx @streetraceing/package inspect update.zip --json
npx @streetraceing/package backup list
```

By default, `apply` hashes the target payload and writes only files whose content
or mode actually differs. Unchanged files keep their timestamps and are excluded
from apply backups and deleted-file cache sessions. Use `--rewrite-all` only when
you intentionally need to rewrite every payload file from the archive.

Before a real `apply`, Package compares the archive identity with the target
project. It uses a verified patch base when available, then `package.json` names,
manifest project metadata, and structural path overlap. A likely cross-project
apply produces a prominent warning and an additional confirmation that requires
typing the target directory name. `--yes` does not bypass this guard. Intentional
non-interactive cross-project application requires the explicit
`--allow-project-mismatch` flag; use `--dry-run` first.

Both command orders work for archive operations:

```bash
npx @streetraceing/package diff update.zip
npx @streetraceing/package update.zip diff
```

Run `npx @streetraceing/package --help` to see every command and option.

## Composing related projects with `depends_on`

For repositories that contain separately configured applications, prefer explicit
project composition over workspace selection. The entry project declares exactly
which other local projects must travel with it, and every project keeps its own
`.packagerc`.

For example:

```text
codeissue/
├─ website/
│  ├─ .packagerc
│  └─ package.json
└─ backend/
   ├─ .packagerc
   └─ package.json
```

`codeissue/website/.packagerc`:

```json
{
  "depends_on": [
    {
      "path": "../backend",
      "name": "@codeissue/backend"
    }
  ],
  "afterApply": ["npm install", "npm run build"]
}
```

`codeissue/backend/.packagerc`:

```json
{
  "ignore": ["coverage/**"],
  "afterApply": ["npm install", "npm run migrate"]
}
```

Work from the entry project exactly as with a single repository:

```bash
cd codeissue/website
package projects
package zip
package shift website.zip --output update.zip
package apply update.zip --dry-run
package apply update.zip --yes
```

`package projects` shows the resolved dependency graph before packaging. The ZIP
above contains `website/**` and `backend/**`, rooted at their shared `codeissue`
directory. `depends_on` is recursive, so `backend` may declare its own dependent
projects. Cycles, duplicate names, missing directories, filesystem-root scopes,
and colliding archive paths are rejected.

Each project is collected using its own `.packagerc`: `include`, `ignore`,
`forceInclude`, Git/package-manager ignore handling, sensitive-file policy,
`preserveMode`, and `preserveMtime` are evaluated locally. The discovered local
`.packagerc` is always carried with its project, even if an ordinary ignore rule
would otherwise omit it. `beforePackage`,
`afterPackage`, `beforeApply`, and `afterApply` also come from each project and
run in dependency-first order with that project's directory as the working
directory. The environment additionally exposes `PACKAGE_PROJECT_NAME`,
`PACKAGE_PROJECT_PATH`, and `PACKAGE_COMPOSITION_ROOT`.

The entry project's configuration controls archive-level settings such as
`name`, `output`, compression, deterministic ZIP output, conflict policy,
backups, and archive cleanup. Run `apply` from the entry project as well: Package
uses that local policy, validates the same `depends_on` graph, and automatically
writes archive paths relative to the shared `codeissue` root. You do not need to
move to the shared root manually.

A short path form is also accepted:

```json
{
  "depends_on": ["../backend"]
}
```

The name then comes from the dependent project's `package.json`, falling back to
its directory name. Dependency paths are resolved relative to the `.packagerc`
that declares them, not relative to its optional `root` value. This keeps custom
config layouts predictable, including `package --config configs/website.json`.

## Legacy monorepo workspace scoping

Package automatically discovers npm, pnpm, Yarn, Bun, Lerna, and Rush-style
workspace layouts from `package.json#workspaces`, `pnpm-workspace.yaml`,
`lerna.json`, and `rush.json`. Use the discovery command to see exactly what the
CLI found before creating an archive:

```bash
package workspaces
package workspaces @acme/api
package workspaces "apps/*" --json
```

Select a workspace by package name, project-relative directory, directory
basename, or glob. Repeat `--workspace` to combine scopes, or use
`--all-workspaces`:

```bash
package zip --workspace @acme/api
package zip -w apps/web -w packages/ui
package zip --workspace "@acme/*" --no-root-files
package zip --all-workspaces
```

Local workspace relationships are read from `dependencies`, `devDependencies`,
`peerDependencies`, and `optionalDependencies`. Graph expansion is recursive, so
an application can include everything it needs or every package that consumes
it:

```bash
package zip -w @acme/api --with-dependencies
package zip -w @acme/ui --with-dependents
package zip -w @acme/core --with-dependencies --with-dependents
```

Scoped archives always keep paths relative to the monorepo root. By default they
also include root-shared files such as lockfiles, workspace declarations,
TypeScript/Nx/Turbo configuration, and `.packagerc`; customize that allowlist
with `monorepo.shared` or disable it with `--no-root-files`.

The selected workspace paths and root-file policy are stored in
`.packagemanifest.json`. `package shift` and `package metadata` inherit that scope
from the base snapshot automatically, including removed workspaces, and reject an
explicitly different scope instead of producing an unsafe partial patch. Create a
new base snapshot when the intended scope changes.

A strict configuration example:

```json
{
  "monorepo": {
    "mode": "auto",
    "workspacePatterns": ["packages/*", "apps/*", "!apps/legacy"],
    "selection": ["@acme/api"],
    "includeDependencies": true,
    "includeDependents": false,
    "includeRootFiles": true,
    "shared": [
      "package.json",
      "pnpm-workspace.yaml",
      "pnpm-lock.yaml",
      "tsconfig.base.json",
      "turbo.json",
      ".packagerc"
    ]
  }
}
```

`mode: "auto"` enables detected layouts, `"on"` also falls back to common
`packages/*`, `apps/*`, `services/*`, `libs/*`, and `modules/*` directories, and
`"off"` disables workspace discovery.

## Configuration and package format

Run `package init` to generate a concise strict-JSON `.packagerc` with only the
settings normally needed to start: schema, archive name, collection strategy,
and Git-ignore behavior. Omitted settings continue to use validated defaults.
Use `package config` to inspect the effective configuration or
`package config --json` to see every resolved value. Use `package init --full`
only when an expanded template is useful.

The init command also creates or updates `.gitignore` with a generated `*.zip`
rule, without duplicating the block on later forced initialization. Pass
`--no-gitignore` when neither Git-ignore selection nor the generated ignore rule
is wanted. Existing configuration is never overwritten without `--force`, and
forced replacement participates in the deleted-file cache.

By default, Package uses Git file selection when it is available; otherwise it
uses its built-in ignore-aware walker. Git metadata, dependencies, previous
package metadata, and backup directories are always excluded.

Use `forceInclude` and `forceIgnore` for paths that must override the normal
selection rules. They take precedence over `include`, `ignore`, dotfile filtering,
`.gitignore`, and the configured package-manager ignore file; `forceIgnore` wins
when both match. Internal safety exclusions still apply, so `.git`,
`node_modules`, reserved Package metadata, and the ZIP currently being written
cannot be forced into an archive.

Lifecycle hooks use npm by default but support any package-manager or build-runner
command. Set `packageManager` to `pnpm`, `yarn`, `bun`, or another executable,
then use `{packageManager}` in a hook command. The resolved value is also
available as `PACKAGE_MANAGER`. `packageManagerIgnore` optionally reads the
configurable `packageManagerIgnoreFile`; its default is `.npmignore` for
npm-compatible workflows. The legacy `npmignore` option remains supported.

Generate ready metadata files without creating an archive:

```bash
package metadata base.zip --message "Describe the update"
package metadata --message "Use the existing manifest as the baseline"
package meta
```

`package metadata` writes `.packagemanifest.json` and `.packageshift` into the
project root. With a base ZIP it records the source snapshot name and SHA-256.
Without an argument it uses the existing `.packagemanifest.json` as the
baseline; when no baseline exists, it creates a current snapshot manifest and an
empty structural `.packageshift`. This command is intended for manual archive
assembly and AI-agent handoffs. `package zip` still recalculates its embedded
manifest when it creates a ZIP.

Snapshot archives contain all selected files and a generated
`.packagemanifest.json`. Update archives contain changed payload files,
`.packageshift`, and metadata that identifies the base snapshot. The
`.packageshift` format describes removals, moves, copies, replacements, and
permission changes that ZIP contents alone cannot represent.

`.packageshift` is always CLI metadata, never project payload. It is parsed in
place and is never copied into the target project. If an older or manually
assembled manifest incorrectly lists it as a payload file, Package ignores that
entry and prints a warning instead of extracting it.

Package lifecycle hooks and archive cleanup are opt-in:

```json
{
  "packageManager": "pnpm",
  "packageManagerIgnore": true,
  "packageManagerIgnoreFile": ".npmignore",
  "forceInclude": [".env.example"],
  "forceIgnore": ["secrets/**"],
  "beforePackage": ["{packageManager} run build"],
  "afterPackage": ["node scripts/report-package.mjs"],
  "beforeApply": [],
  "afterApply": ["{packageManager} run prepare"],
  "deletePackageOnApply": false,
  "deleteSourcePackageOnApply": false,
  "saveDeletedCache": true
}
```

`beforePackage` and `afterPackage` run around `zip` and `shift`. `beforeApply`
runs after validation and confirmation but before files are changed. `afterApply`
runs after a successful apply as a best-effort hook: failed commands produce
warnings, do not roll back project changes, and do not stop later hooks or archive
cleanup. For a single project, hooks run sequentially from its root. With `depends_on`,
hooks run dependency-first from each owning project's root. The terminal prints a
`├─ ▸ <project> │ <path> ───` project separator before each project's hook block,
so command output from sibling projects does not visually run together. They receive
`PACKAGE_HOOK`, `PACKAGE_COMMAND`, `PACKAGE_ROOT`, `PACKAGE_ARCHIVE`,
`PACKAGE_MANAGER`, `PACKAGE_PROJECT_NAME`, `PACKAGE_PROJECT_PATH`, and
`PACKAGE_COMPOSITION_ROOT`.
Empty arrays run nothing. `deletePackageOnApply` defaults to `false`; when enabled, the applied ZIP
is deleted after the project files are applied, even if an `afterApply` command
reports an error.

`deleteSourcePackageOnApply` also defaults to `false`. Update archives created by
`package shift` record the source snapshot name and SHA-256. Package searches for
that exact snapshot next to the applied archive, in the composition root, and in
every participating project root. If explicit source metadata is unavailable, the
same locations are used to find exactly one snapshot whose manifest matches the
project state before apply. This matters when an update ZIP is placed at the shared
`depends_on` root while the original snapshot remains inside the entry project.
When cleanup is explicitly enabled, Package deletes only an exact matching regular
file; hash mismatches, ambiguity, symlinks, and failed or dry-run applies are
preserved.

## Deleted-file cache

`saveDeletedCache` defaults to `true`. Before Package itself removes or replaces a
regular file, it saves the previous contents outside the project:

```text
~/streetraceing/.package/cache/<project-id>/<operation-id>
```

On Windows this is below `%USERPROFILE%\streetraceing\.package\cache`. Each
operation contains the cached files and `.packagecache.json` metadata with the
original path, deletion reason, size, mode, and SHA-256. The cache covers files
replaced or removed by `apply`, `backup restore`, archive output replacement,
`init --force`, `deletePackageOnApply`, and `deleteSourcePackageOnApply`.
Commands inside lifecycle hooks run as separate shell processes, so files deleted
by custom hooks cannot be intercepted.

Files larger than 10 MiB are cached normally, but Package prints a warning before
the destructive operation continues. A successful command prints the cache path
and total saved size. Disable this behavior globally with
`"saveDeletedCache": false` or once with `--no-save-deleted-cache`.

Terminal output uses two complementary palettes. Help and reference screens
(`package -h`) intentionally stay in soft white and gray shades. Operational
commands use one consistent tree: `┌─` starts a section, every status/detail row
uses a neutral `├─` connector, and the muted `└────` divider is the only
terminator. A separate one-cell semantic glyph carries status (`◆` success, `●`
information, `▲` warning, `×` error), while change rows use `+`, `~`, `−`, `↪`,
`◇`, or `!`. Connector color therefore never changes halfway through a tree.
Colors are automatically disabled for redirected output and JSON mode; set
`NO_COLOR=1` to disable them explicitly.

## Backup history

Persistent apply backups are stored outside the project so they cannot be packaged
or accidentally committed:

```text
~/streetraceing/.package/backups/<project-id>
```

On Windows this resolves under `%USERPROFILE%\streetraceing\.package`. Each
version stores the pre-apply state of affected paths and integrity metadata. Older
project-local `.package-backups` archives remain discoverable for compatibility.

```bash
package backup list
package backup inspect 1
package backup restore latest
package backup restore 3 --yes
```

Restoring an older version applies every newer rollback delta in reverse order.
Before restoration, Package creates a recovery backup of the current state, making
the rollback itself reversible. Set `STREETRACEING_PACKAGE_HOME` to override the
package data directory for automation or isolated environments.

See the [AI agent guide](docs/AGENTS.md),
[configuration schema](docs/schema.json), and
[`.packageshift` format reference](docs/PACKAGESHIFT.md) for full details.

## Development

Install dependencies and run the TypeScript source directly:

```bash
npm install
npm run dev -- zip
```

Validate the project, run tests, and build the production CLI:

```bash
npm run check
```

Useful individual commands:

```bash
npm run typecheck
npm test
npm run build
npm start -- zip
```

TypeScript is compiled into `dist/`. The `bin` entry in `package.json` points to
`dist/bin/package.js`, so package users only need Node.js, not TypeScript or
runtime npm dependencies.

## Test the npm package locally

To test the exact package contents, create a tarball and run it in another
project:

```bash
npm pack
npx --yes --package=/absolute/path/to/streetraceing-package-<version>.tgz package --help
```

Inspect the files that would be published without creating the tarball:

```bash
npm run pack:check
```

The published package contains the compiled CLI and supporting modules, schema,
documentation, README, and license. Tests and `node_modules` are excluded.

## MVP limitations

- ZIP64 and multi-disk ZIP archives are not supported.
- ZIP entries are limited to 1 GiB and expanded archives to 4 GiB.
- Generated rename detection only matches identical file content.
- Applying a snapshot is an overlay; files absent from it are not removed unless
  `.packageshift` explicitly removes them.
- Manually assembled `.packageshift` archives without a manifest cannot verify
  the base project before applying.
- The fallback file walker covers common Git-ignore behavior; Git remains the
  authoritative collection strategy for complex repositories.

## About

Project source archiver and safe update-package CLI.

<https://streetraceing.github.io/package>

## License

[MIT](./LICENSE) © Package contributors.
