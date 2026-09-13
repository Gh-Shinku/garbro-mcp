# NScripter SAR resource archive

## Reference and attribution

- GARBro reference: `ArcFormats/NScripter/ArcSAR.cs`, class `SarOpener`
- GARbro tag: `SAR`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARbro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

Every length in this archive is big-endian. The file begins with an entry count and the offset where payloads
start; that offset must lie inside the file and be large enough for ten bytes per entry, which is the
reference's only bound on the count — there is no sanity ceiling beyond it.

Names follow the header as plain null-terminated bytes, so this format's index is not encrypted, unlike the
NScripter script files themselves. Each record then holds a big-endian data offset relative to the payload
start and a big-endian size. The reference checks before each field that the index region has room for it, so a
truncated index is rejected rather than read past, and the port keeps those checks together with the
placement check on every entry.

The format carries neither a signature nor a registered extension in GARbro, so those structural checks are
the detection. Payloads are stored verbatim and the reader installs no entry decoder. The reference also
implements archive creation, which is outside the scope of this read-only port.

## Support

| Capability | Status |
| --- | --- |
| Big-endian count and payload offset | Supported |
| Per-entry room and minimum-size checks | Supported |
| Plain null-terminated CP932 names | Supported |
| Big-endian relative offset and size records | Supported |
| Entry placement validation | Supported |
| Structural detection without a signature | Supported |
| Verbatim extraction | Supported |
| Archive creation | Not ported |
| Archive creation | Unsupported |

Synthetic fixtures cover a two-entry archive, an empty count, a payload start too small for the count, and an
entry whose payload leaves the file.
