# DJSYSTEM engine DAT resource archive

## Reference and attribution

- GARBro reference: `ArcFormats/DjSystem/ArcDAT.cs`, class `DatOpener`
- GARBro tag: `DAT/DJSYSTEM`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The archive is a CP932 text index followed by the data it describes. The first line is the marker
`FILECMB-DATA-LIST-IN`, records are tab-separated name, start, and end offsets, and `LIST-END` closes
the list, so every entry lies inside the same file. Entries named `*.vic` are audio.

Payloads that start with `DJCODE NLINE-` are script containers. An `ENCODE` marker means the payload
is XORed with 0xff behind a 20-byte header and simply loses that header, while a `NO-ENCODE` marker
means CRLF pairs collapse and the remaining bytes are XORed behind a 23-byte header. GARbro performs
both transforms while opening the entry, so the second one changes the byte count; the port unwraps
that variant while listing, because only then is the unpacked size known and extraction can verify
it.

## Support

| Capability | Status |
| --- | --- |
| Marker detection | Supported |
| CP932 text index | Supported |
| Tab-separated offset records | Supported |
| `ENCODE` script unwrapping | Supported |
| `NO-ENCODE` CRLF collapse and XOR | Supported |
| Entry placement validation | Supported |
| CP932 filenames | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the text index, both script containers, and marker rejection.
