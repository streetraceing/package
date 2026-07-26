# @streetraceing/package

A dependency-free TypeScript CLI for creating clean project ZIP archives, comparing them with a local project, and applying structured update packages safely.

Requires Node.js 18 or later.

Documentation: https://streetraceing.github.io/package

## Use

Run without installing:

```bash
npx @streetraceing/package zip
npx @streetraceing/package diff update.zip
npx @streetraceing/package apply update.zip
```

Or install globally:

```bash
npm install --global @streetraceing/package

package zip
package update.zip diff
package update.zip apply
```

Both command orders are supported:

```bash
package diff update.zip
package update.zip diff
```

## Main workflow

Create a full snapshot:

```bash
package zip
```

The default output is `<project-folder>.zip`. The archive contains the selected project files and a newly generated `.packagemanifest.json` with SHA-256 hashes, Unix modes, and package metadata. When the configured `shiftFile` exists, it is validated and embedded as `.packageshift`.

Create an update package after changing the project:

```bash
package shift base.zip --output update.zip
```

Preview the update against another copy of the project:

```bash
package diff update.zip
package apply update.zip --dry-run
```

Apply it:

```bash
package apply update.zip
```

In CI or another non-interactive shell, pass `--yes`:

```bash
package apply update.zip --yes
```

Before writing, `apply` validates paths, archive integrity, the base project hash, expected file hashes, and symbolic-link boundaries. By default it creates a backup in `.package-backups/` and rolls back partial changes when an operation fails.

## Commands

```text
package zip [directory]
package shift <base.zip>
package diff <archive.zip>
package apply <archive.zip>
package inspect <archive.zip>
package check <archive.zip>
package list [archive.zip]
package init
```

Useful options:

```text
--cwd <path>                Select the project directory
--config <path>             Select a config file
-o, --output <path>         Set the output archive
--ignore <glob>             Add an ignore pattern; repeatable
--include <glob>            Add an include pattern; repeatable
--strategy <git|walk>       Select collection strategy
--[no-]gitignore            Toggle .gitignore support
--[no-]npmignore            Toggle .npmignore support
--[no-]dot                  Include or exclude dotfiles
--compression-level <0-9>   Set ZIP compression
--json                      Print machine-readable output
```

Apply options:

```text
--dry-run
--yes
--force
--backup / --no-backup
--conflict abort|overwrite|skip
```

Run `package --help` for the complete command reference.

## File selection

The default strategy is `git`. Inside a Git worktree, the CLI uses:

```bash
git ls-files --cached --others --exclude-standard
```

This respects tracked files, nested `.gitignore` files, `.git/info/exclude`, and the user's global Git ignore rules.

When Git is unavailable, or `strategy` is set to `walk`, the CLI uses its internal directory walker and ignore matcher.

These paths are always excluded:

```text
.git/**
node_modules/**
.package-backups/**
.packagemanifest
.packagemanifest.json
.packageshift
```

These metadata paths are reserved at the project root and are not added to the payload manifest or root hash. Existing manifest files are never trusted or copied: the CLI always generates `.packagemanifest.json` again. The configured `shiftFile` is read separately, so it can still be embedded when dotfiles, glob rules, or ignore files would normally exclude it. The archive currently being created is excluded automatically.

## Configuration

Run this command to create `.packagerc`:

```bash
package init
```

The generated file includes the JSON Schema URL `https://streetraceing.github.io/package/schema.json` for editor completion and validation. `.packagerc` uses strict JSON: all keys and strings must use double quotes, and comments or trailing commas are not allowed.

```json
{
  "$schema": "https://streetraceing.github.io/package/schema.json",
  "type": "zip",
  "root": ".",
  "output": ".",
  "name": "{folder}.zip",
  "strategy": "git",
  "gitignore": true,
  "npmignore": false,
  "include": ["**/*"],
  "ignore": ["dist/**", "coverage/**", "src/assets/**"],
  "dot": true,
  "followSymlinks": false,
  "includeEmptyDirectories": false,
  "manifest": true,
  "shiftFile": ".packageshift",
  "compressionLevel": 9,
  "deterministic": true,
  "preserveMode": true,
  "preserveMtime": false,
  "sensitiveFiles": "warn",
  "backupOnApply": true,
  "conflictStrategy": "abort",
  "renameDetection": true,
  "renameThreshold": 0.8
}
```

`dot` defaults to `true` so important files such as `.github`, `.npmrc`, and tool configuration are not silently omitted. Potential secret files such as `.env`, private keys, and `.npmrc` produce a warning by default. Set `sensitiveFiles` to `error` or `allow` to change that behavior.

## Snapshot and patch archives

A snapshot ZIP stores all selected files:

```text
project.zip
├── src/...
├── package.json
├── .packagemanifest.json
└── .packageshift        # only when shiftFile exists
```

A shift ZIP stores only added and modified payload files, plus structural operations:

```text
update.zip
├── changed/files/...
├── .packagemanifest.json
└── .packageshift
```

Exact renames are detected by matching SHA-256 hashes. Ambiguous fuzzy renames are not applied automatically.

## `.packageshift`

`.packageshift` describes file-system operations that archive contents alone cannot express. During `package zip`, the configured `shiftFile` is parsed before the ZIP is written and stored under the canonical archive path `.packageshift`:

```text
PACKAGESHIFT 1

MESSAGE "Rename the API client and remove obsolete code"
BASE sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef

REMOVE "src/api/unused.ts" IF sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
MOVE "src/api/old.ts" TO "src/api/new.ts" IF sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
COPY "src/config/default.ts" TO "src/config/production.ts"
REPLACE "src/index.ts" IF sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc
CHMOD "scripts/deploy.sh" 755
```

Paths must be relative to the project root and use forward slashes. Absolute paths and `..` segments are rejected.

See [docs/PACKAGESHIFT.md](docs/PACKAGESHIFT.md) for the compact format reference.

## Development

```bash
npm install
npm run check
npm run build
npm run pack:check
```

The published package contains compiled JavaScript in `dist/`; end users do not need TypeScript or any runtime npm dependency.

## Current limits

- ZIP64 and multi-disk ZIP archives are not supported.
- ZIP entries must be smaller than 1 GiB; expanded archives are limited to 4 GiB.
- Rename generation is intentionally limited to exact-content matches.
- Snapshot application is an overlay. Files absent from a snapshot are not removed unless `.packageshift` explicitly removes them.
- The fallback ignore walker covers common Git ignore behavior; Git itself remains the authoritative strategy for complex repositories.

## License

MIT
