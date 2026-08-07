# Package documentation

Package is a dependency-free TypeScript CLI for creating project source
snapshots, generating update archives, and safely applying them to another copy
of a project.

## Recent updates

- `package init` now creates a concise starter configuration; use
  `package config --json` to inspect resolved defaults or `package init --full`
  for the expanded template.
- Related local projects can be composed explicitly with project-local
  `depends_on` declarations. Every project keeps its own file rules and hooks.
- Workspace auto-discovery remains available as a legacy scoping workflow.
- `forceInclude` and `forceIgnore` can override ordinary file-selection and
  ignore rules without weakening Package's internal safety exclusions.
- Lifecycle hooks now support npm by default or another package manager/build
  runner through `packageManager`, `{packageManager}`, and `PACKAGE_MANAGER`.
- Operational output now keeps every tree connector neutral and uses compact
  semantic status/change glyphs beside `├─` rows.

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

## Start a configuration

Create the small configuration most projects need:

```bash
package init
```

The generated `.packagerc` contains the schema URL, archive name, collection
strategy, and Git-ignore choice. Other settings remain active through validated
defaults rather than being copied into every new project. Inspect them at any
time:

```bash
package config
package config --json
```

Use `package init --full` for an expanded reference template,
`package init --force` to intentionally replace an existing config, and
`package init --no-gitignore` to skip both Git-ignore selection and the generated
`*.zip` block.

## Project composition with `depends_on`

Use explicit composition when separately configured projects must be packaged and
updated together. The project where the command is launched is the **entry
project**. It declares local dependencies in its own `.packagerc`, and every
dependent project loads its own `.packagerc` recursively.

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

Run the ordinary workflow from `website`:

```bash
cd codeissue/website
package projects
package zip
package shift website.zip --output update.zip
package apply update.zip --dry-run
package apply update.zip --yes
```

The snapshot and update archive contain both `website/**` and `backend/**`, with
paths rooted at their shared `codeissue` directory. `package projects` prints the
resolved graph before packaging. `depends_on` may be recursive; cycles, missing
directories, duplicate names, and colliding archive paths are rejected.

Each project independently controls `include`, `ignore`, force rules, Git and
package-manager ignore handling, sensitive-file policy, mode/mtime preservation,
and lifecycle hooks. A discovered local `.packagerc` is always carried with its
project, even when an ordinary ignore rule would omit it. Hooks run dependency-first in the directory of the project
that owns them. The entry project controls archive-level settings such as output,
compression, backup, conflict, and cleanup policies.

A dependency may also use the short form:

```json
{
  "depends_on": ["../backend"]
}
```

Its name is inferred from `package.json`, then from the directory name. Run
`apply` from the entry project; Package automatically targets the shared root, so
both sibling directories are updated while entry-level apply policy is preserved.
Each dependency path is relative to the `.packagerc` that declares it, even when
that configuration sets a different project `root`.

## Legacy monorepo workspace scoping

Workspace discovery supports `package.json#workspaces`, `pnpm-workspace.yaml`,
`lerna.json`, and `rush.json`. Use it only when a package-manager workspace scope
is the desired delivery unit rather than an explicit project relationship.

```bash
package workspaces
package zip -w @acme/api --with-dependencies
package zip -w packages/ui --with-dependents
package zip --all-workspaces --no-root-files
```

Selectors accept package names, root-relative paths, basenames, and globs. Local
dependency and dependent expansion is recursive. Scoped payload paths remain
relative to the monorepo root, and `monorepo.shared` controls root lockfiles and
shared configuration.

The manifest records the workspace scope. `shift` and `metadata` inherit it from
the base snapshot and reject a conflicting explicit scope with
`WORKSPACE_SCOPE_MISMATCH`. `depends_on` composition and workspace selection
cannot be combined in one archive.

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
  first uses the exact filename and SHA-256 recorded by `package shift`, searching
  beside the update archive, in the composition root, and in every participating
  project root. If that reference is unavailable, the same locations are searched
  for exactly one snapshot whose manifest matches the project state before apply.
  This covers the common case where the update ZIP is stored at the shared root
  while the source snapshot remains in the entry project. Ambiguous or changed
  archives are preserved. It is `false` by default.

For one project, hook commands run sequentially from its root. In a
`depends_on` composition, they run dependency-first from each owning project's
root. Each project hook block is introduced by a `├─ ▸ project │ path ───`
separator so output stays visually grouped. Hook processes receive `PACKAGE_HOOK`,
`PACKAGE_COMMAND`, `PACKAGE_ROOT`,
`PACKAGE_ARCHIVE`, `PACKAGE_MANAGER`, `PACKAGE_PROJECT_NAME`,
`PACKAGE_PROJECT_PATH`, and `PACKAGE_COMPOSITION_ROOT`.

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
is intentionally white-and-gray only. Operational sections start with `┌─`, use
a neutral `├─` for every row, and end only at the muted `└────` divider. Semantic
meaning belongs to the adjacent glyph (`◆`, `●`, `▲`, `×`, or a change marker),
so connector colors stay stable from top to bottom. Redirected output stays
plain; `NO_COLOR=1` disables colors explicitly.

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
