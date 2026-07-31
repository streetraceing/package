export const helpText = `@streetraceing/package
Package, compare, and safely apply project source archives.

Usage:
  package zip [directory] [options]
  package shift <base.zip> [options]
  package metadata [base.zip|manifest.json] [options]
  package diff <archive.zip> [options]
  package apply <archive.zip> [options]
  package backup [list]
  package backup inspect <version> [--json]
  package backup restore <version|latest> [--yes]
  package inspect <archive.zip> [--json]
  package check <archive.zip>
  package list [archive.zip] [--json]
  package init [--force]

The archive-first form is also supported:
  package update.zip diff
  package update.zip apply

Run without a global installation:
  npx @streetraceing/package zip
  npx @streetraceing/package update.zip diff

Core options:
  --cwd <path>                Project directory
  --config <path>             Strict JSON config (default: .packagerc)
  -o, --output <path>         Output archive path
  --ignore <glob>             Add an ignore pattern; repeatable
  --include <glob>            Add an include pattern; repeatable
  --strategy <git|walk>       File collection strategy
  --[no-]gitignore            Enable or disable .gitignore handling
  --[no-]npmignore            Enable or disable .npmignore handling
  --[no-]dot                  Include or exclude dotfiles
  --compression-level <0-9>   ZIP compression level
  --json                      Machine-readable output
  -q, --quiet                 Reduce output

Apply options:
  --dry-run                   Validate and preview without writing
  -y, --yes                   Skip interactive confirmation
  -f, --force                 Ignore base/hash conflicts
  --allow-project-mismatch    Explicitly allow applying to another project
  --[no-]backup               Keep or disable a versioned backup
  --delete-package            Delete the applied archive after success
  --keep-package              Keep the applied archive (default)
  --delete-source-package     Delete the exact source snapshot referenced by a shift archive
  --keep-source-package       Keep the source snapshot (default)
  --save-deleted-cache        Preserve deleted/replaced files in the user cache
  --no-save-deleted-cache     Disable deleted-file caching for this command
  --conflict <strategy>       Handle local/hash conflicts: abort, overwrite, or skip

Backup commands:
  package backup list         Show all versions for the current project
  package backup inspect 1    Show metadata for a listed version
  package backup restore 1    Restore that version and every newer delta
  package backup restore latest --yes

Backups are stored outside projects in:
  ~/streetraceing/.package/backups/<project-id>

Deleted/replaced files are cached by default in:
  ~/streetraceing/.package/cache/<project-id>/<operation-id>

Files larger than 10 MiB are cached with a warning. Set NO_COLOR to disable ANSI colors.

Metadata and shift options:
  --message <text>            Add a MESSAGE instruction

Metadata generation:
  package metadata base.zip   Recalculate .packagemanifest.json and .packageshift
  package metadata            Use the existing .packagemanifest.json as the baseline
  package meta                Short alias for package metadata

Examples:
  package zip
  package zip ./my-project --output release.zip
  package shift base.zip --output update.zip
  package metadata base.zip --message "Prepared update"
  package diff update.zip
  package apply update.zip --dry-run
  package apply update.zip --yes
  package backup list
  package backup restore latest
`;
