# Nyoken ZLK resource archive

## Reference and attribution

- GARBro reference: `Legacy/Nyoken/ArcZLK.cs`, class `ZlkOpener`
- GARbro tag: `ZLK`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARbro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The signature spells `ZLK` and a space, the word behind it is a version that must land between one and a hundred,
and the entry count sits at 8. Records follow at 12 with a stride that varies from one to the next: each holds the
data offset, a packed size, an unpacked size, a flag byte and a name length byte, followed by that many name
bytes. A zero name length rejects the archive, as does a blank name, and each payload is validated against the
file.

A non-zero flag marks the payload as deflated, and the unpacked size is recorded alongside the stored span. The
format registers no extension, so the header fields and the record walk are the detection.

## Extraction

A deflated payload is streamed through zlib, and anything else is emitted verbatim. The reference decompresses
without checking the result against the declared length, so the port streams the output and marks those entries as
having an inexact size.

## Support

| Capability | Status |
| --- | --- |
| `ZLK` signature and version range | Supported |
| Entry count validation | Supported |
| Variable-stride records | Supported |
| Packed and unpacked sizes with a flag byte | Supported |
| CP932 names with length validation | Supported |
| Entry placement validation | Supported |
| zlib extraction for deflated payloads | Supported |
| Verbatim extraction for stored payloads | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover a stored entry, a deflated entry, a version outside its range, a zero name length, and an
empty entry count.
