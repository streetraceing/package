---
title: @streetraceing/package
---

# @streetraceing/package

A command-line tool for packaging, comparing, and safely applying project source archives.

`.packagerc` is a strict JSON configuration file with schema support.

- [Configuration schema](./schema.json)
- [PackageShift format](./PACKAGESHIFT.md)

```bash
npx @streetraceing/package zip
npx @streetraceing/package diff update.zip
npx @streetraceing/package apply update.zip
```
