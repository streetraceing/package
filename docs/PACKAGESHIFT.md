# .packageshift format

A `.packageshift` file contains one instruction per line. Blank lines and lines beginning with `#` are ignored. When `package zip` finds the configured `shiftFile`, it validates the file and embeds it in the archive as `.packageshift`, independently of dotfile, include, ignore, and Git ignore filtering.

The first instruction is mandatory:

```text
PACKAGESHIFT 1
```

## Metadata

```text
MESSAGE "Human-readable update description"
BASE sha256:<64 hexadecimal characters>
```

`BASE` identifies the snapshot from which a generated patch was created. The CLI also stores the base file manifest in the update archive so it can verify the target project before applying changes.

## File instructions

Remove a file only when its current content still matches the expected hash:

```text
REMOVE "src/api/unused.ts" IF sha256:<hash>
```

Move or rename a file:

```text
MOVE "src/api/old.ts" TO "src/api/new.ts" IF sha256:<hash>
```

Copy an existing project file:

```text
COPY "src/config/default.ts" TO "src/config/production.ts"
```

Require an existing file to match a hash before replacing it with the payload stored in the archive:

```text
REPLACE "src/index.ts" IF sha256:<hash>
```

Change Unix permissions:

```text
CHMOD "scripts/deploy.sh" 755
```

The `IF sha256:...` condition is optional, but recommended for destructive operations. When a local hash differs, interactive `package apply` asks whether to abort, overwrite, or skip. The same behavior can be selected directly with `--conflict abort|overwrite|skip`; `--force` bypasses all base and per-file hash guards.

## Paths

Paths are always relative to the selected project root:

```text
src/api/client.ts
```

Use forward slashes on every operating system. Absolute paths, drive-letter paths, NUL bytes, and paths containing `..` are rejected.

`.packageshift`, `.packagemanifest.json`, and `.packagemanifest` are reserved
CLI metadata paths. Instructions cannot target them, and `.packageshift` is
never extracted into the project as payload. Older archives that incorrectly
list reserved metadata in their manifest are accepted with a warning and those
entries are ignored during `diff` and `apply`.

## Generate the file automatically

Use `package metadata` to calculate structural instructions and write both
`.packageshift` and `.packagemanifest.json` into the project root:

```bash
package metadata base.zip --message "Describe the update"
package metadata --message "Use the existing manifest as baseline"
```

The first form compares the current project with a snapshot ZIP. The second form
loads the existing project-root `.packagemanifest.json` before replacing it. The
short alias is `package meta`. Added and modified file contents are represented by
the generated manifest and eventual archive payload; `.packageshift` records the
structural operations that payload alone cannot express.

## Validation

Validate an archive and parse its shift file without changing the project:

```bash
package check update.zip
```

A manually created archive may contain `.packageshift` without `.packagemanifest.json`. In that case the CLI validates the ZIP payload and .packageshift syntax, generates temporary file metadata in memory, and reports that embedded manifest/base verification is unavailable. Legacy JSON metadata stored as `.packagemanifest` is also supported.

Preview the complete application plan:

```bash
package apply update.zip --dry-run
```

Parser errors include the source line, column, error code, failing line, and a correction hint.

## Source snapshot cleanup

Shift archives created by `package shift` record the source snapshot filename and
SHA-256 in `.packagemanifest.json`. This metadata is separate from the
`.packageshift` instruction language.

When `deleteSourcePackageOnApply` or `--delete-source-package` is enabled,
Package searches for that snapshot beside the applied update archive and in the
target project root. It deletes only a regular file whose filename and SHA-256
both match the recorded source. The default is `false`; symlinks, mismatches,
missing snapshots, dry runs, and failed applies are retained.
