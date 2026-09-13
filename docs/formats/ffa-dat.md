# FFA System DAT resource archives

## Reference and attribution

- GARBro reference: `ArcFormats/Ffa/ArcBlackPackage.cs`, classes `DatOpener` and `JDatOpener`
- Shared unpacker: `ArcFormats/LzssStream.cs`, class `LzssReader`
- GARBro tags: `FFA/DAT` and `FFA/JDAT`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Version one (`FFA/DAT`)

The index lives in a sibling `.lst` file. Its length has to divide exactly into 0x16-byte records and the resulting count
may not exceed sixteen bits.

| Offset | Size | Meaning |
| --- | --- | --- |
| 0x00 | 14 | Name |
| 0x0E | 4 | Payload offset |
| 0x12 | 4 | Stored size |

The archive itself carries no index, so the payload offsets point into the `.dat` and every placement is validated.

## Version two (`FFA/JDAT`)

The index sits at the end of the archive, at the offset stored in the first word. Its length has to divide exactly into
0x34-byte records:

| Offset | Size | Meaning |
| --- | --- | --- |
| 0x00 | 0x20 | Name |
| 0x20 | 4 | Payload offset, recorded four bytes low |
| 0x24 | 4 | Stored size |

## Packed entries

Both versions share one extraction path. An entry is only unpacked when all of the following hold:

- its name carries the `.so4` or `.so5` extension,
- its stored size leaves room for an eight-byte header,
- the header's first word — the packed length — is positive and exactly eight bytes short of the stored size,
- the header's second word — the unpacked length — is positive.

The payload behind the header is a GARbro LZSS stream with the `LzssReader` settings: a 4 KiB frame pre-filled with
zeroes and an initial write position of 0xFEE. Decoding stops at the declared unpacked size, and whatever the stream does
not fill stays zero, exactly as the reference's pre-allocated buffer behaves.

The port applies the same header test while listing, so a listing's declared sizes and its extraction always agree.

## Support

| Capability | Status |
| --- | --- |
| `.dat` extension with a `.lst` companion index | Supported |
| Record size exactness and sixteen-bit count limit | Supported |
| Fourteen-byte names with offsets and sizes | Supported |
| Trailing version-two index and 0x20-byte names | Supported |
| Payload offsets recorded four bytes low | Supported |
| `.so4` / `.so5` header detection | Supported |
| LZSS unpacking to the declared size | Supported |
| Entry placement validation | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover a `.lst`-indexed archive with a packed and a stored entry, an entry whose header is
inconsistent and therefore stays stored, a missing companion index, an index that does not divide into records, a
version-two archive with a packed entry, an out-of-range index offset and an out-of-range payload.

## Tooling note

The `ffa` format directory already exported another module. `scripts/add-dir-export.mjs` was added while porting this
format so a directory index is appended to instead of being rewritten, which had silently dropped an export twice
before.
