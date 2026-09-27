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

The report tools work from **1129** of those rows rather than from all 1132: three inventory entries are the
template drafts `ArcFormats/DraftArc.cs`, `ArcFormats/DraftAudio.cs` and `ArcFormats/DraftImage.cs`, whose
class names carry question marks in place of a real name, whose tag reads as `xxx`, and which nothing can
reach. `scripts/garbro-gap.mjs` leaves them out rather than counting them as work that is not done, so both
numbers are correct: 1132 inventory rows, 1129 rows of work.

Progress is read from three places:

* [`support-status.json`](support-status.json) — one record per row, the authority on what a row supports and
  what it still refuses;
* [`packages/formats/src/support.generated.ts`](../packages/formats/src/support.generated.ts) — generated from
  those records by `scripts/generate-format-support.mjs`, and what the packages expose;
* `scripts/garbro-gap.mjs` — the live totals and the list of rows that are not started.

A human readable rollup of all of that, with the reasons behind the rows that are not started and the real
functional gaps inside the ported rows, stands in [`status.md`](status.md).

Use [`test-data-targets.md`](test-data-targets.md) when acquiring private validation samples. It
selects one representative game for every row in GARbro's official supported-formats table.

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
