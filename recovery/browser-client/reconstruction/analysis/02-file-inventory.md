# 02 File Inventory

`artifacts/file-inventory.csv` records relative path, byte size and SHA-256 for every immutable input file. `artifacts/js-file-metrics.csv` separately classifies top-level first-party JS/MJS files by syntax diagnostics, lines and size.

The inventory distinguishes:

- 10 first-party executable/module JS/MJS entries;
- 2 first-party JSON configurations;
- the `classic-level.mjs` adapter;
- vendored third-party packages and native prebuilds.
