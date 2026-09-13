# Squadra D PLA audio archive

## Reference and attribution

- GARBro reference: `Legacy/SquadraD/ArcPLA.cs`, class `PlaOpener`
- GARBro tag: `PLA`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The header repeats the file size at 4, stores a rotation check at 8 (`(size & 0xd5555555) << 1 |
size & 0xaaaaaaaa`), the value 2 at 0x10, and a 16-bit record count at 0x0e.

The index at 0x14 is a set of four parallel tables: record ids, 16-byte audio parameter blocks whose
channel count sizes the next table, the data offsets, and the per-record sample data that GARbro only
skips over. Sizes are derived backwards from the end of the file, so every entry runs up to the next
recorded offset. Payloads are extracted raw; the port exposes the sample rate and channel count as
entry metadata.

## Support

| Capability | Status |
| --- | --- |
| Signature, size, and check-word validation | Supported |
| Parallel index tables | Supported |
| Channel-sized sample table | Supported |
| Backwards size derivation | Supported |
| Audio parameter metadata | Supported |
| Entry placement validation | Supported |
| Generated entry names | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the parallel tables, derived sizes, check-word rejection, and size
rejection.
