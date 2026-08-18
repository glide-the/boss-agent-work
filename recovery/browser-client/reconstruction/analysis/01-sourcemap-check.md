# 01 Source Map Check

The initial scan found no `.map`, `sourceMappingURL`, `sourcesContent`, `webpack://` or `vite://` evidence for Browser Client.

Consequence: exact author paths, comments, local names, generic types and module boundaries cannot be proven. Review `artifacts/sourcemap-check.json` after every reproduction run; if evidence appears, stop semantic reconstruction and inspect it first.
