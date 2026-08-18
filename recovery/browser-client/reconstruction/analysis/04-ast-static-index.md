# 04 AST Static Index

All top-level first-party `.js` and `.mjs` inputs are parsed with TypeScript Compiler API using `ScriptKind.JS` and `ESNext`.

Generated evidence:

- `imports.json` and `exports.json`;
- `declarations.csv`;
- `functions.csv` and `classes.csv`;
- `call-graph.json`.

The call graph is syntactic. Proxy, reflection, transport dispatch and runtime-injected functions remain dynamic blind spots.
