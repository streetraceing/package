# Package documentation

Package is a dependency-free TypeScript CLI for creating project source
snapshots, generating update archives, and safely applying them to another copy
of a project.

## Guides

| Guide                                       | Use it when you need to...                                                                                   |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| [Configuration schema](./schema.json)       | Configure file selection, ZIP output, metadata, and apply behavior in `.packagerc`.                          |
| [`.packageshift` format](./PACKAGESHIFT.md) | Understand or author file removals, moves, copies, replacements, mode changes, and source snapshot metadata. |

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

Run `npx @streetraceing/package --help` for the complete command reference.

## Optional package lifecycle settings

```json
{
  "beforePackage": ["npm run build"],
  "afterPackage": ["node scripts/report-package.mjs"],
  "beforeApply": [],
  "afterApply": ["npm run prepare"],
  "deletePackageOnApply": false,
  "deleteSourcePackageOnApply": false
}
```

- `beforePackage` runs before file collection for `zip` and `shift`.
- `afterPackage` runs after the archive is written.
- `beforeApply` runs after validation and confirmation, before files change.
- `afterApply` runs after a successful apply as a best-effort hook. A failed
  command prints a warning; later hooks and cleanup still continue.
- `deletePackageOnApply` removes the applied archive after project changes are
  written, even if an `afterApply` command fails. It is `false` by default.
- `deleteSourcePackageOnApply` removes the source snapshot referenced by a shift
  archive only when its filename and SHA-256 both match. It is `false` by default.

Hook commands run sequentially from the project root and receive
`PACKAGE_HOOK`, `PACKAGE_COMMAND`, `PACKAGE_ROOT`, and `PACKAGE_ARCHIVE`.

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

## Principles

- **Safe by default:** Package validates archive paths and integrity, expected
  hashes, and symbolic-link boundaries. Applying an update creates a backup by
  default and rolls back a partial operation when it fails.
- **Project-aware selection:** Git file selection is used when available;
  otherwise Package uses its built-in ignore-aware file walker. Git metadata,
  dependencies, package metadata, and backup directories are always excluded.
- **Structured updates:** update archives carry payload files, a manifest, and
  `.packageshift` instructions for operations ZIP entries cannot express.
- **Conflict-aware application:** use `diff` or `apply --dry-run` to review
  changes, then select `abort`, `overwrite`, or `skip` conflict handling when
  needed.

Manually assembled `.packageshift` archives without an embedded manifest are
supported, but cannot verify that the target matches the base project.

Return to the [project README](../README.md).
