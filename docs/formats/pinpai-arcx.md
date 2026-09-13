# Pinpai arcx resource archive

## Reference and attribution

- GARBro reference: `Legacy/Pinpai/ArcARC.cs`, class `ArcOpener`
- GARBro tag: `ARC/arcx`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2016 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The archive starts with the `arcx` ASCII signature. A signed 32-bit entry count follows at offset four, and the index
begins at offset 0x10 with 0x20-byte records: a 0x10-byte CP932 name, a stored size, and an absolute payload offset.
Both the payload size and offset are checked against the file.

GARbro derives the compression mode from the archive filename: archives whose base name is `wav` are stored, while
every other archive is packed. Packed payloads are prefixed by a little-endian unpacked size word and store the rest as
a default GARbro LZSS stream. The reference reads that size word lazily in `OpenEntry`; this port reads it while
building the index so listings report the declared unpacked size, and marks the entries as having an inexact size
because the decoder stops at the end of the stored stream.

## Extraction

Stored archives emit each entry verbatim. Packed archives decode everything behind the four-byte size word as a
default LZSS stream. Names ending in `.b` are reported as `image` entries in metadata.

## Support

| Capability | Status |
| --- | --- |
| `arcx` signature and signed entry count | Supported |
| Fixed 0x20-byte index records | Supported |
| CP932 names and placement validation | Supported |
| Filename-driven packed/stored mode | Supported |
| Declared unpacked size word | Supported |
| Default LZSS extraction | Supported |
| Verbatim extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover packed and stored archives, the `wav` filename exception, `.b` type inference, and
out-of-file and unsane-count rejection.
