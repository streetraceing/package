# PackageShift format

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

The `IF sha256:...` condition is optional, but recommended for destructive operations.

## Paths

Paths are always relative to the selected project root:

```text
src/api/client.ts
```

Use forward slashes on every operating system. Absolute paths, drive-letter paths, NUL bytes, and paths containing `..` are rejected.

## Validation

Validate an archive and parse its shift file without changing the project:

```bash
package check update.zip
```

Preview the complete application plan:

```bash
package apply update.zip --dry-run
```

Parser errors include the source line, column, error code, failing line, and a correction hint.
