# Crowd engine PCK archive

## Reference and attribution

- GARBro reference: `ArcFormats/Crowd/ArcPCK.cs`, class `PckOpener`
- GARBro tag: `PCK`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARbro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The entry count sits at 0, bounded at 0xFFFFF. The index starts at 4 and holds 0xC-byte records: one
word the reference ignores, then the data offset and the size. GARbro checks only that an offset
exceeds the index size itself rather than the four header bytes in front of it, and the port keeps that
comparison rather than tightening it.

The names follow the whole index as null-terminated CP932 strings, and each must terminate within a
260-byte window, so an unterminated or empty name rejects the archive. The port reads them in a second
pass over the stored offset and size words so the entries can be created with their final paths.
Payloads are stored verbatim, and the format has neither a signature nor an extension, so the layout
and the name window are the detection.

The sibling `PKWV` audio archive in the same GARbro file parses RIFF format chunks and synthesises wave
headers; it is a separate format and is not part of this port.

## Support

| Capability | Status |
| --- | --- |
| Entry count bounds | Supported |
| 0xC-byte index records | Supported |
| Offset beyond the index size | Supported |
| Entry placement validation | Supported |
| Null-terminated names bounded by 260 bytes | Supported |
| CP932 filenames | Supported |
| Entry listing and extraction | Supported |
| `PKWV` audio archive | Not ported |
| Archive creation | Unsupported |

Synthetic fixtures cover the trailing name table, an empty entry count, an offset pointing inside the
index, and an unterminated name.
