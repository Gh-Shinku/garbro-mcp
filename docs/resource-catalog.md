# Entry resource catalogue

Archive entries carry an optional `resourceType` (`archive`, `audio`, `image`, `script`, or `unknown`). The
shared classifier mirrors the two GARbro catalogue lookups used by archive readers:

- file-name extensions, including the aliases recorded in [`format-aliases.md`](format-aliases.md);
- the first four payload bytes interpreted as a little-endian signature.

The source of truth is [`garbro-inventory.json`](garbro-inventory.json). Inventory schema version 2 records
the effective extension and signature arrays for every exported GARbro resource. Literal constructor values
are extracted automatically; the generator has an explicit, source-and-class-keyed override table for the two
upstream values that are computed or defined outside their exported class. Unresolved expressions stop
generation so catalogue coverage cannot silently shrink.

Run these commands after changing the GARbro baseline or extraction rules:

```bash
pnpm inventory:garbro
pnpm catalog:resources
pnpm format
```

Extension classification succeeds only when all matching resources have the same category. Signature
classification is stricter and requires exactly one matching resource, matching `AutoEntry.DetectFileType`;
its Ogg, RIFF/WAVE, and bitmap special cases are applied before the general table. Ambiguous or absent evidence
leaves an entry unclassified.
