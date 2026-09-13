# Shape Shifter BND resource archive

## Reference and attribution

- GARBro reference: `Legacy/ShapeShifter/ArcBND.cs`, class `BndOpener`
- GARBro tag: `BND`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The entry count is an int32 at 0x00 and the word at 0x04 has to be exactly where an index of twelve-byte records ends.

Every index record is:

| Offset | Size | Meaning |
| --- | --- | --- |
| 0x00 | 4 | Payload offset |
| 0x04 | 4 | Unpacked size |
| 0x08 | 4 | Stored size |

An entry counts as compressed when those two sizes differ, and every placement is validated. Entries are named
`<archive>#<index>` with a four-digit index, using the archive's base name in upper case, and their type comes from the
archive name unless it names none:

| Archive name | Type |
| --- | --- |
| `SCR` | `script` |
| `VOICE`, `SE` | `audio` |
| `PICT` | `image` |
| anything else | untyped, so the payloads are inspected |

## Bitmap detection

Archives with an unnamed type inspect each payload for a bitmap marker, reading the stored or unpacked data as the
compression flag dictates:

- A compressed entry matches when the low sixteen bits of its first word are the `BM` marker.
- A stored entry matches when its first word carries a one-byte prefix in front of the marker, matching `0x?? 0x42 0x4D`
  in the low three bits of the prefix byte.

A match sets the entry type to image and renames it to `.bmp`. Compressed payloads are decoded as GARbro LZSS streams and
everything else is stored.

## Registration

GARbro exports this opener inside an `#if DEBUG` block, so release builds never register it. The port implements the
format and records the limitation, mirroring the earlier treatment of EBG_SYSTEM's debug-only bitmap archive.

## Support

| Capability | Status |
| --- | --- |
| Entry count and first-offset check | Supported |
| Twelve-byte records with both sizes | Supported |
| Compression flag from the size mismatch | Supported |
| Archive-name derived type and naming | Supported |
| Bitmap marker detection, plain and prefixed | Supported |
| LZSS payload decoding | Supported |
| Entry placement validation | Supported |
| Release-build registration | Unsupported |
| Archive creation | Unsupported |

Synthetic fixtures cover an archive-name type, a retyped unpacked bitmap, a packed entry without a marker, an audio
archive and two malformed indexes.
