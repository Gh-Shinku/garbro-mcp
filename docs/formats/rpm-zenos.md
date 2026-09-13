# Zenos archive

## Reference and attribution

- GARBro reference: `ArcFormats/RPM/ArcZENOS.cs`, class `ZenosOpener` (index reader `ArcIndexReader`)
- GARBro tag: `ARC/ZENOS`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2017 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

A Zenos archive starts with a record count at 0 and an index at 4 with a fixed 0x10-byte name
field. Each record is 0x1c bytes: the CP932 name, the unpacked size, the stored size, and the data
offset. Like `ARC/RPM`, the index is decrypted with a keyword recovered from the archive: the first
data offset is `4 + count * 0x1c`, which yields the key bytes to search for in the padding of the
first name field. Every entry is LZSS-compressed and inherits the default frame used by the shared
RPM opener.

## Support

| Capability | Status |
| --- | --- |
| Structural detection | Supported |
| 0x1c-byte records | Supported |
| Keyword recovery and index decryption | Supported |
| Monotonic first-offset validation | Supported |
| Default LZSS decompression | Supported |
| CP932 filenames | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Entries report the unpacked size as their final size and keep the stored size as `packedSize`.

Synthetic fixtures cover the index layout, keyword recovery, LZSS payloads, and rejection of
unrelated data.
