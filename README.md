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
- path, archive-integrity, base-project, and per-file conflict checks, with
  versioned backups, rollback history, recovery backups, and a deleted-file cache;
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
npx @streetraceing/package apply update.zip --conflict=skip
npx @streetraceing/package inspect update.zip --json
npx @streetraceing/package backup list
```

Both command orders work for archive operations:

```bash
npx @streetraceing/package diff update.zip
npx @streetraceing/package update.zip diff
```

Run `npx @streetraceing/package --help` to see every command and option.

## Configuration and package format

Run `package init` to generate a strict-JSON `.packagerc` file with schema
support. By default, Package uses Git file selection when it is available;
otherwise it uses its built-in ignore-aware walker. Git metadata, dependencies,
previous package metadata, and backup directories are always excluded.

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
  "beforePackage": ["npm run build"],
  "afterPackage": ["node scripts/report-package.mjs"],
  "beforeApply": [],
  "afterApply": ["npm run prepare"],
  "deletePackageOnApply": false,
  "deleteSourcePackageOnApply": false,
  "saveDeletedCache": true
}
```

`beforePackage` and `afterPackage` run around `zip` and `shift`. `beforeApply`
runs after validation and confirmation but before files are changed. `afterApply`
runs after a successful apply as a best-effort hook: failed commands produce
warnings, do not roll back project changes, and do not stop later hooks or archive
cleanup. Hooks run sequentially from the project root and receive `PACKAGE_HOOK`,
`PACKAGE_COMMAND`, `PACKAGE_ROOT`, and `PACKAGE_ARCHIVE`. Empty arrays run
nothing. `deletePackageOnApply` defaults to `false`; when enabled, the applied ZIP
is deleted after the project files are applied, even if an `afterApply` command
reports an error.

`deleteSourcePackageOnApply` also defaults to `false`. Update archives created by
`package shift` record the source snapshot name and SHA-256. When that metadata
is unavailable, the CLI safely looks next to the applied archive and in the
project root for exactly one snapshot whose manifest matches the project state
before apply. When cleanup is explicitly enabled, Package deletes only an exact
matching regular file beside the update archive or in the project root; missing
metadata, hash mismatches, symlinks, and failed or dry-run applies are preserved.

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

Terminal output uses restrained ANSI colors when connected to an interactive
terminal. Colors are automatically disabled for redirected output and JSON mode;
set `NO_COLOR=1` to disable them explicitly.

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
