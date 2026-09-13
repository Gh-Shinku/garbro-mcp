# Sogna DAT resource archive

## Reference and attribution

- GARBro reference: `Legacy/Sogna/ArcSGS.cs`, class `SgsDatOpener`
- GARBro tag: `DAT/SGS`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2016 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The archive starts with the ASCII signature `SGS.DAT 1.00`. A signed 32-bit entry count sits at offset 0x0c, and
0x20-byte records start at 0x10: a 0x10-byte CP932 name, a packed flag at 0x13, the stored size at 0x14, the unpacked
size at 0x18, and the payload offset at 0x1c. Every payload is checked against the file.

## Extraction

Entries with a clear packed flag are emitted verbatim. Packed entries use the reference's private LZ scheme: a control
byte supplies eight flags from its high bits. A set flag reads a little-endian word whose low twelve bits are the
distance back into the decoded output and whose high four bits plus one give the copy length; a clear flag reads one
literal byte. Copies overlap, so runs longer than the distance repeat correctly.

GARbro allocates the declared unpacked size and stops when it is reached or the input ends, so a short stream leaves
zero-filled tail bytes; the port reproduces that behavior and reports the declared size as exact.

## Support

| Capability | Status |
| --- | --- |
| `SGS.DAT 1.00` signature and entry count | Supported |
| Fixed 0x20-byte index records | Supported |
| CP932 names and placement validation | Supported |
| Packed flag with stored and unpacked sizes | Supported |
| Sogna LZ extraction with overlapped copies | Supported |
| Verbatim extraction | Supported |
| Entry type inference | Unsupported |
| Archive creation | Unsupported |

Synthetic fixtures cover stored and packed entries, overlapping matches, zero-filled short streams, and out-of-file and
foreign-signature rejection.
