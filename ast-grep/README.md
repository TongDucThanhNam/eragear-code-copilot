# ast-grep

This directory contains structural architecture checks for the TypeScript and
TSX source tree. The root `sgconfig.yml` discovers the rules and their tests.

Use the narrowest search tool that answers the question:

- `rg` for filenames, literal text, and symbol names.
- `ast-grep run` for syntax-aware searches and reviewed codemods.
- TypeScript or an LSP for type-aware references and call graphs.

Run the project checks with:

```powershell
bun run ast:test
bun run ast:scan
```

`bun run check:ast` runs both commands. Architecture rules have `error`
severity, so a match fails the scan. Add a rule only for a stable project
boundary, include valid and invalid test cases, and confirm the full repository
is clean before enabling it.
