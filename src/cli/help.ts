export const helpText = `@streetraceing/package
Package, compare, and safely apply project source archives.

Usage:
  package zip [directory] [options]
  package shift <base.zip> [options]
  package diff <archive.zip> [options]
  package apply <archive.zip> [options]
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
  --[no-]backup               Keep or disable a persistent backup
  --conflict <strategy>       abort, overwrite, or skip

Shift options:
  --message <text>            Add a MESSAGE instruction

Examples:
  package zip
  package zip ./my-project --output release.zip
  package shift base.zip --output update.zip
  package diff update.zip
  package apply update.zip --dry-run
  package apply update.zip --yes
`;
