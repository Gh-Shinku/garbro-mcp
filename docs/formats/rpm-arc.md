# RPM ARC archive

## Reference and attribution

- GARBro reference: `ArcFormats/RPM/ArcARC.cs`, class `ArcOpener` (index reader `ArcIndexReader`)
- GARBro tag: `ARC/RPM`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

An `ARC` archive starts with a record count at 0 and a compression flag at 4, which must be 0 or 1.
The index follows at 8. Records are `name field + 12 bytes`; the name field is either 0x20 or 0x18
bytes wide, so GARbro probes the wider layout first, and the trailing bytes hold the unpacked size,
the stored size, and the data offset, all little-endian.

GARbro has no fixed scheme table for this engine: the index is decrypted with a keyword that is
recovered from the archive itself. `ArcIndexReader.GuessScheme` uses the first data offset, which
follows directly from the record width, to derive four key bytes from the first record, locates the
repeating key pattern in the zero padding of the first name field, and accepts the candidate only
when the recovered keyword is printable ASCII. Index decryption then adds the keyword byte-wise
with its length as the period. Entries with the compression flag are expanded with the default
GARbro LZSS variant.

Archives named `instdata.arc` are special-cased: when the guessed keyword is not `inst`, GARbro
replaces it with `inst` while keeping the recorded name width.

## Support

| Capability | Status |
| --- | --- |
| Structural detection | Supported |
| Compression flag validation | Supported |
| 0x20 and 0x18 name fields | Supported |
| Keyword recovery and index decryption | Supported |
| `instdata.arc` keyword override | Supported |
| Monotonic first-offset validation | Supported |
| Default LZSS decompression | Supported |
| CP932 filenames | Supported |
| Entry listing and extraction | Supported |
| User-supplied keyword fallback | Unsupported |
| Archive creation | Unsupported |

The interactive fallback to a user-configured keyword depends on GARbro's dialog and settings
database, so only self-describing archives are readable. Compressed entries report the unpacked size
as their final size and keep the stored size as `packedSize`.

Synthetic fixtures cover the index layout, both name widths, keyword recovery, LZSS payloads, the
`instdata.arc` override, and entry placement rejection.
