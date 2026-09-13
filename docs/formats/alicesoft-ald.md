# AliceSoft System ALD archive

## Reference and attribution

- GARBro reference: `ArcFormats/AliceSoft/ArcALD.cs`, class `AldOpener`
- GARBro tag: `ALD`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

An `ALD` archive is indexed from the end. A 16-byte trailer holds the engine version at +0, the
value 0x10 at +4, and a 16-bit record count at +9; GARbro accepts the versions 0x014c4e and 0x012020.
The index length is the low three bytes of the first word shifted left by eight.

The record table starts at offset 3 with 24-bit offsets stored shifted right by eight, which is why
every record begins on a 256-byte boundary. A zero offset ends the walk. Each record is then read
through its own header: a header size that must exceed 0x10, the stored size, and the name filling
the rest of the header, with the payload starting behind it.

## Support

| Capability | Status |
| --- | --- |
| Trailer detection for both known versions | Supported |
| 24-bit shifted offset table | Supported |
| Zero-offset terminator | Supported |
| Per-record header parsing | Supported |
| Index length validation | Supported |
| Entry placement validation | Supported |
| CP932 filenames | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the trailer, the shifted index, name decoding, both known versions, and
version rejection.
