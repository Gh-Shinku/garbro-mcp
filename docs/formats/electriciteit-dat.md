# Electriciteit DAT resource archive

## Reference and attribution

- GARBro reference: `Legacy/Electriciteit/ArcDAT.cs`, class `DatOpener`
- GARBro tag: `DAT/electr`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The archive starts with a 32-bit record count and records from offset 4 with a 0x2c-byte stride: a
0x10-byte CP932 name, the data offset at +0x24, and the stored size at +0x28. GARbro rejects blank
and rooted names and requires every payload to start behind the index. The format is registered for
the `dat` extension.

GARbro marks entries as images when the archive name starts with `b`; the port keeps that flag in the
entry metadata.

## Support

| Capability | Status |
| --- | --- |
| Extension-based detection | Supported |
| 0x2c-byte records | Supported |
| Name validation | Supported |
| First-offset validation | Supported |
| Entry placement validation | Supported |
| Bitmap archive flag | Supported |
| CP932 filenames | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the record layout, the bitmap flag, index-bound rejection, and extension
rejection.
