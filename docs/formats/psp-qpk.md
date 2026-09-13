# PSP QPK resource archive

## Reference and attribution

- GARBro reference: `ArcFormats/Psp/ArcQPK.cs`, class `PakOpener`
- GARBro tag: `QPK`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The archive only carries the `QPK\0` signature. Everything else lives in a sibling index with the same base name and
the `.QPI` extension, which must start with `QPI\0`. The reference reads the record count at 0x04 and starts the record
array at 0x1C; a count that does not fit inside the index fails the format, because the reference reads records through
a bounds-checked view.

Each record is two little-endian words: a payload offset and a flag word whose low 30 bits hold the unpacked size. A
record is dropped from the listing when the high bit is set or the flag word is zero; all offsets must stay within the
archive file.

Entry names are synthesized as `<base name>#<index>` with a zero-padded five-digit index, because the index carries no
names. Archives whose base name is `TGA` get a `.tga` extension and the `image` type, mirroring the reference.

## Layout recovery

The index does not store the packed size. The reference walks the surviving records backwards and derives each size
from the distance to the next entry offset, ending at the archive size. The port reproduces that walk, clamps the
result to the bytes actually available (the reference clamps its stream view the same way), and marks entries whose
declared extent had to be clamped as having an inexact size.

## Extraction

An entry flagged with 0x40000000 is decoded when its stored data starts with `CZL\0`, followed by the compressed size
and a zlib stream. Flagged entries without the marker, and all unflagged entries, are emitted verbatim over the
recovered extent.

## Support

| Capability | Status |
| --- | --- |
| `QPK\0` signature | Supported |
| Companion `QPI\0` index | Supported |
| Records from 0x1C with flag/size word | Supported |
| High-bit and zero record skipping | Supported |
| Synthesized `base#index` names | Supported |
| `TGA` archive image typing | Supported |
| Back-filled stored sizes | Supported |
| `CZL\0` zlib extraction | Supported |
| Verbatim extraction | Supported |
| Entry type inference beyond `TGA` names | Unsupported |
| Archive creation | Unsupported |

Synthetic fixtures cover stored and `CZL` entries, skipped records, the `TGA` image typing, a missing companion index
and a foreign index signature.
