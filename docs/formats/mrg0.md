# F&C Co. MRG0 archive

## Reference and attribution

- GARBro reference: `ArcFormats/FC01/ArcMRG0.cs`, class `Mrg0Opener`
- GARBro tag: `MRG/mrg0`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`MRG0` archives begin with the ASCII signature `mrg0`. A little-endian header follows:

| Offset | Size | Meaning |
| --- | ---: | --- |
| 0x00 | 4 | signature `mrg0` |
| 0x04 | 4 | entry count |
| 0x08 | 4 | offset of the first entry payload |
| 0x0c | 4 | unused |

The index starts at 0x10 and uses 0x4c-byte records:

| Offset | Size | Meaning |
| --- | ---: | --- |
| 0x00 | 0x40 | null-terminated CP932 filename |
| 0x40 | 4 | entry size |
| 0x44 | 8 | unused |

Entry payloads are stored sequentially starting at the declared data offset, in index order. The
declared offset is used as-is; sizes are never derived from neighbouring records.

The GARbro opener does not verify that the declared data offset follows the index. This port keeps
the same behavior but still requires the index and payload ranges to lie inside the file, matching
GARbro's `Entry.CheckPlacement` rejection path.

## Support

| Capability | Status |
| --- | --- |
| Signature detection | Supported |
| CP932 filenames | Supported |
| Sequential data offsets | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover CP932 names, nested names, sequential payloads, truncated indexes, and
out-of-range entries.
