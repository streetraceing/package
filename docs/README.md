# Package documentation

Package is a dependency-free TypeScript CLI for creating project source
snapshots, generating update archives, and safely applying them to another copy
of a project.

## Guides

| Guide                                       | Use it when you need to...                                                                                     |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| [AI agent guide](./AGENTS.md)               | Give coding agents an exact, safe workflow for reading, modifying, validating, and returning package archives. |
| [Configuration schema](./schema.json)       | Configure file selection, ZIP output, metadata, and apply behavior in `.packagerc`.                            |
| [`.packageshift` format](./PACKAGESHIFT.md) | Understand or author removals, moves, copies, replacements, mode changes, and source snapshot metadata.        |

## Fastest path

Create a project snapshot:

```bash
npx @streetraceing/package zip
```

To use the `package` command directly, install it globally:

```bash
npm install --global @streetraceing/package
package zip
```

After changing the project, create an update package from that snapshot and
preview it before writing anything:

```bash
npx @streetraceing/package shift base.zip --output update.zip
npx @streetraceing/package diff update.zip
npx @streetraceing/package apply update.zip --dry-run
```

Apply an approved update non-interactively:

```bash
npx @streetraceing/package apply update.zip --yes
```

Package writes only added, modified, or mode-changed payload files by default.
Unchanged files are not opened for writing and keep their timestamps. To restore
the former full-overlay behavior intentionally, pass:

```bash
package apply snapshot.zip --rewrite-all
```

Package checks whether the archive appears to belong to the target project. A
likely mismatch requires a second interactive confirmation; `--yes` alone does
not bypass it. For an intentional automated cross-project apply, review with
`--dry-run` and pass `--allow-project-mismatch` explicitly.

Run `npx @streetraceing/package --help` for the complete command reference.

## File-selection priorities

`forceInclude` and `forceIgnore` are repeatable project-relative glob lists for
exceptions to normal selection. They override `include`, `ignore`, dotfile
filtering, `.gitignore`, and the configured package-manager ignore file.
`forceIgnore` wins if both lists match. Package still never collects `.git`,
`node_modules`, reserved metadata files, or the archive currently being written.

Use `packageManager` to select the command exposed to lifecycle hooks. It is
`npm` by default but accepts `pnpm`, `yarn`, `bun`, or any build runner. In hook
commands, `{packageManager}` expands to that value and `PACKAGE_MANAGER` exposes
it to child processes. Enable `packageManagerIgnore` to read
`packageManagerIgnoreFile` (default `.npmignore`); `npmignore` remains a legacy
alias.

## Optional package lifecycle settings

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

- `beforePackage` runs before file collection for `zip` and `shift`.
- `afterPackage` runs after the archive is written.
- `beforeApply` runs after validation and confirmation, before files change.
- `afterApply` runs after a successful apply as a best-effort hook. A failed
  command prints a warning; later hooks and cleanup still continue.
- `deletePackageOnApply` removes the applied archive after project changes are
  written, even if an `afterApply` command fails. It is `false` by default.
- `deleteSourcePackageOnApply` removes one safely identified source snapshot. It
  first uses the exact filename and SHA-256 recorded by `package shift`; when that
  reference is unavailable, it accepts exactly one snapshot beside the update
  archive or in the project root whose manifest matches the project state before
  apply. Ambiguous or changed archives are preserved. It is `false` by default.

Hook commands run sequentially from the project root and receive
`PACKAGE_HOOK`, `PACKAGE_COMMAND`, `PACKAGE_ROOT`, `PACKAGE_ARCHIVE`, and
`PACKAGE_MANAGER`.

## Deleted-file cache

`saveDeletedCache` is `true` by default. Before a CLI-managed deletion or
replacement, Package copies the previous regular file into
`~/streetraceing/.package/cache/<project-id>/<operation-id>`; Windows resolves
that path below `%USERPROFILE%`. A `.packagecache.json` file records original and
cached paths, reasons, modes, sizes, and SHA-256 values.

The cache covers destructive `apply` and `backup restore` changes, replacement of
an existing ZIP output, `init --force`, and package/source-package cleanup.
User-defined hook scripts are separate processes, so their own deletions cannot be
captured. Files over 10 MiB are still saved and produce an explicit warning.
Use `--no-save-deleted-cache` for one command or set `saveDeletedCache` to `false`
to disable the feature.

Interactive output separates reference text from operational status. Help output
is intentionally white-and-gray only. Operational output uses a consistent tree:
`┌─` starts a section, `├─` and `└─` list details, and `┞─` marks warnings and
changes. Semantic colors distinguish success/additions, information/modifications,
structural operations, cautions, and removals or errors. Redirected
output stays plain; `NO_COLOR=1` disables colors explicitly.

## Backup versions

Apply backups are stored per project under
`~/streetraceing/.package/backups/<project-id>`; on Windows the same path is
resolved below `%USERPROFILE%`. Legacy `.package-backups` archives are still
listed and restorable.

```bash
package backup list
package backup inspect 1
package backup restore latest
package backup restore 3 --yes
```

A restore creates a recovery backup first, then restores the selected version and
every newer delta. The recovery version can be selected later to undo the rollback.
`STREETRACEING_PACKAGE_HOME` can override the data directory.

## Generate metadata files

Use `metadata` when project files are already prepared and you need ready
metadata files in the project root without creating a ZIP:

```bash
package metadata base.zip --message "Describe the update"
package metadata --message "Use the current .packagemanifest.json as baseline"
package meta
```

The command recalculates the complete snapshot `.packagemanifest.json` and
creates `.packageshift` structural instructions. Baseline selection is:

1. the explicitly supplied snapshot ZIP or manifest;
2. the existing project-root `.packagemanifest.json`;
3. no baseline, producing an empty structural `.packageshift`.

When a ZIP baseline is supplied, its filename and SHA-256 are recorded so source
package cleanup can identify it safely. The command preserves application files
and replaces only the two reserved metadata files.

## Principles

- **Safe by default:** Package validates archive paths and integrity, expected
  hashes, and symbolic-link boundaries. Applying an update creates a backup by
  default and rolls back a partial operation when it fails.
- **Project-aware selection:** Git file selection is used when available;
  otherwise Package uses its built-in ignore-aware file walker. Git metadata,
  dependencies, package metadata, and backup directories are always excluded.
- **Structured updates:** update archives carry payload files, a manifest, and
  `.packageshift` instructions for operations ZIP entries cannot express.
  `.packageshift` remains reserved CLI metadata and is never written into the
  target project, even when a malformed legacy manifest lists it as payload.
- **Selective application:** unchanged payload files are not rewritten by
  default. Use `--rewrite-all` only for an intentional full payload rewrite.
- **Conflict-aware application:** use `diff` or `apply --dry-run` to review
  changes, then select `abort`, `overwrite`, or `skip` conflict handling when
  needed.

Manually assembled `.packageshift` archives without an embedded manifest are
supported, but cannot verify that the target matches the base project.

Return to the [project README](../README.md).
