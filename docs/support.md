# GARbro support tracking

The project tracks compatibility against GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`. This is a fixed behavioral baseline; updating it is a
separate reviewed change rather than an incidental result of implementing a format.

## Baseline

The generated inventory currently contains 1,132 exported resource implementations:

| Resource type | GARbro exports |
| --- | ---: |
| Archive | 606 |
| Image | 424 |
| Audio | 91 |
| Script | 11 |
| **Total** | **1,132** |

These numbers count exported implementations, not unique filename extensions or engines. GARbro may
export multiple implementations with the same tag, and a single implementation may handle several
format variants.

The complete generated baseline is stored in [`garbro-inventory.json`](garbro-inventory.json).
Project-specific progress and known limitations are stored separately in
[`support-status.json`](support-status.json). Entries absent from the status file are considered
`not-started`.

## Status definitions

- `not-started`: no project implementation is tracked.
- `in-progress`: implementation work exists but does not yet provide a usable vertical slice.
- `partial`: useful behavior is implemented, but known GARbro variants or capabilities are missing.
- `verified`: the declared scope has passed deterministic tests and differential validation against
  real GARbro output.

An exported GARbro implementation is not considered fully aligned merely because its common variant
can be extracted. The status record must identify unsupported encryption, companion-file,
multi-volume, creation, or resource-decoding behavior.

## Regenerating the inventory

Keep a GARbro checkout at `GARbro/`, checked out to the baseline commit, then run:

```powershell
pnpm inventory:garbro
```

The generator scans GARbro's C# export declarations and records resource type, tag, implementing
class, source path, and declared extensions. Review the baseline commit and generated diff before
committing an inventory update.
