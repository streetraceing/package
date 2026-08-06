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
  package projects [--json]
  package workspaces [selector] [--json]
  package config [--json]
  package init [--force] [--full]

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
  --force-include <glob>      Include despite normal selection and ignore rules; repeatable
  --force-ignore <glob>       Exclude despite normal selection and include rules; repeatable
  --strategy <git|walk>       File collection strategy
  --[no-]gitignore            Enable or disable .gitignore handling
  --[no-]npmignore            Legacy alias for package-manager ignore handling
  --package-manager <name>    Lifecycle package manager / build runner (default: npm)
  --[no-]package-manager-ignore  Enable or disable the configured ignore file
  --package-manager-ignore-file <path>  Ignore filename for the configured manager
  --[no-]dot                  Include or exclude dotfiles
  --compression-level <0-9>   ZIP compression level
  --json                      Machine-readable output
  -q, --quiet                 Reduce output

Initialization:
  package init                Create a concise starter .packagerc
  package init --full         Create an expanded config with every option
  package config              Show the effective config, including defaults
  package config --json       Print the complete effective config as JSON

The concise config keeps only the schema, archive name, strategy, and gitignore
choice. Omitted settings continue to use the documented safe defaults.


Project composition:
  Declare sibling or related projects in the entry project's .packagerc:
    "depends_on": [{ "path": "../backend", "name": "@codeissue/backend" }]

  package projects             Show the resolved project graph and archive root
  package zip                  Package the entry project and every depends_on project
  package shift base.zip       Update the same project graph
  package apply update.zip     Apply paths from the shared root and run each project's hooks locally

Each composed project loads its own .packagerc. File rules and lifecycle hooks
belong to that project; hooks run in dependency-first order from its own root.
The entry project controls archive-level output, compression, and apply policy.

Legacy monorepo workspace options:
  -w, --workspace <selector>  Select by package name, path, basename, or glob; repeatable
  --all-workspaces            Select every detected workspace
  --workspace-pattern <glob>  Add a workspace directory pattern; repeatable
  --with-dependencies         Recursively include local workspace dependencies
  --with-dependents           Recursively include local workspace dependents
  --[no-]root-files           Include or exclude configured root-shared files
  --[no-]monorepo             Force-enable or disable workspace discovery

Legacy workspace discovery reads package.json workspaces, pnpm-workspace.yaml,
lerna.json, and rush.json. Scoped archives keep monorepo-root-relative paths.

Apply options:
  --dry-run                   Validate and preview without writing
  -y, --yes                   Skip interactive confirmation
  -f, --force                 Ignore base/hash conflicts
  --allow-project-mismatch    Explicitly allow applying to another project
  --rewrite-all               Rewrite every payload file, including unchanged files
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

Files larger than 10 MiB are cached with a warning.
Help stays white/gray; operational commands use semantic colors and symbols.
Set NO_COLOR to disable ANSI colors.

Metadata and shift options:
  --message <text>            Add a MESSAGE instruction

Metadata generation:
  package metadata base.zip   Recalculate .packagemanifest.json and .packageshift
  package metadata            Use the existing .packagemanifest.json as the baseline
  package meta                Short alias for package metadata

Examples:
  package zip
  package zip ./my-project --output release.zip
  package projects
  package config
  package workspaces
  package zip --workspace @acme/api --with-dependencies
  package zip --all-workspaces --no-root-files
  package shift base.zip --output update.zip
  package metadata base.zip --message "Prepared update"
  package diff update.zip
  package apply update.zip --dry-run
  package apply update.zip --yes
  package apply snapshot.zip --rewrite-all
  package backup list
  package backup restore latest
`;
