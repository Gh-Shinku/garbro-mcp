# Kurumi engine MPK resource archive

Reference: `GARbro/Legacy/Kurumi/ArcMPK.cs`, class `MpkOpener` (the `MpkCompression` codec behind
the packed flag is not ported yet) (GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/kurumi/mpk.ts` (`kurumiMpkDescriptor`, `kurumiMpkFormat`, id
`kurumi-mpk`).

## Header

| Offset | Size | Meaning |
|--------|------|---------|
| `0x00` | 2 | `MP` |
| `0x02` | 1 | version, at most one |
| `0x04` | 4 | entry count (`i32`) |
| `0x08` | 4 | data offset (`u32`) |
| `0x0C` | | index block |

The data offset must be above the twelve byte header and below the end of the file.

## Blocks

The index and every payload are stored as the same kind of block:

| Offset | Size | Meaning |
|--------|------|---------|
| `0x00` | 4 | unpacked size, **big endian** |
| `0x08` | 1 | flag: zero means the payload follows as it is, non zero selects the codec |
| `0x09` | | stored bytes |

The reference reads the block through `Decompress`, which turns the flag into either the raw bytes at
`+9` or an `MpkCompression` stream of `packed size - 9` bytes.

## Index records

The decompressed index is a list of `0x104` byte records, read one after another:

| Offset | Meaning |
|--------|---------|
| `+0x00` | name, cp932, up to `0xF8` bytes, terminated by a zero |
| `+0xF8` | offset (`u32`), relative to the data offset |
| `+0xFC` | stored size (`u32`), including the nine byte block header |
| `+0x100` | unpacked size (`u32`) |

Every entry is marked as packed by the reference and is decompressed when it is opened. Each entry
must pass the placement check, and the index has to hold at least `count * 0x104` bytes.

## Deviations

* The `MpkCompression` codec is not ported yet, so an index block with the flag set is declined
  (listing such an archive is impossible without it) and a packed payload is passed through exactly
  as it is stored. Unpacked blocks are extracted exactly like the reference extracts them.
* Archive creation is out of scope.
