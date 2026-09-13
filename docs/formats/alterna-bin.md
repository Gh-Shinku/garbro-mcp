# Alterna resource archive

## Reference and attribution

- GARBro reference: `Legacy/Alterna/ArcBIN.cs`, class `BinOpener`
- GARBro tag: `BIN/ARC1`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The archive carries no index of its own. The reference replaces the archive's extension with `.lst`, refuses archives
that already use the `.lst` extension, and requires that sibling file to exist. The list starts with the `ARC1.00`
marker, holds a record count at 0x08 and 0x30-byte records at 0x10.

Each record contains a packing flag, the unpacked size, the stored size, the payload offset and a 0x20-byte name whose
bytes are inverted up to the first NUL. Names are decoded as CP932, and offsets are checked against the archive file
rather than the list.

Packing alone is not enough to decode an entry: the reference also requires the stored data to begin with the `LZSS`
marker. The port probes that marker while parsing the list, so the listing and extraction agree; entries without the
marker keep their stored size and are served verbatim, while decoded entries expose the unpacked size recorded in the
list and shed the eight-byte marker.

## Extraction

`LZSS` payloads are decoded with GARbro's standard LZSS stream except that the reference moves the frame start to
0xFF0 instead of the default 0xFEE; the port passes that setting through. Because the decoder runs to the end of its own
stream, the declared unpacked size is reported as a hint rather than as a verified length. Entries without the marker,
and all unpacked entries, are emitted verbatim.

## Support

| Capability | Status |
| --- | --- |
| Sibling `.lst` lookup with extension replacement | Supported |
| `.lst` main-file rejection | Supported |
| `ARC1.00` list signature and record count | Supported |
| 0x30-byte records with inverted names | Supported |
| Packing flag and unpacked size | Supported |
| `LZSS` marker probe | Supported |
| LZSS decoding with a 0xFF0 frame start | Supported |
| Verbatim extraction | Supported |
| Entry placement validation | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover stored entries, a packed entry behind the marker, a packed entry without the marker, a missing
sibling list, a main file that is itself a list and a list with a foreign signature.
