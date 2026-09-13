# AliceSoft AAR resource archive

## Reference and attribution

- GARBro reference: `ArcFormats/AliceSoft/ArcAAR.cs`, class `AarOpener`
- GARbro tag: `AAR`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARbro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The archive starts with `AAR\0`, the entry count sits at 8, and the index begins at 0xC. A record holds
a data offset, a size, a flag word, and a null-terminated CP932 name, which the reference reads without a
length bound; the port scans for the terminator as well, with the shared helper's own bound.

The flag word marks an entry as compressed unless it equals one, but `AarOpener.OpenEntry` never
consults it: it decides from the payload's `ZLB\0` marker instead. The port follows the same rule for
extraction and still exposes the index flag as metadata, together with whether that flag would have
marked the entry as stored.

## Deviation

GARbro reads the unpacked size and the packed size of a `ZLB` payload from the absolute file offsets 8
and 0xC, which hold the archive's entry count and its first index word rather than anything belonging to
the entry, and then starts the stream sixteen bytes into the entry. Those reads can only produce
garbage, so the port reads both words relative to the entry, where the marker and the sixteen-byte
header place them, and extracts the payload as a zlib stream. This is a deliberate, documented
correction rather than a silent fix.

## Support

| Capability | Status |
| --- | --- |
| `AAR\0` signature and `.red` extension | Supported |
| Entry count validation | Supported |
| Records with offset, size, flag and name | Supported |
| Null-terminated CP932 names | Supported |
| Entry placement validation | Supported |
| Index flag exposure (compressed unless one) | Supported |
| `ZLB\0` detection and per-entry header words | Supported, with the deviation above |
| zlib extraction | Supported |
| Verbatim extraction for other payloads | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover a stored and a `ZLB` payload, a foreign signature, an empty entry count, and a
payload outside the file.
