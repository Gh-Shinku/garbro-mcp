# PKWARE ZIP archive

## Reference and attribution

- GARbro reference: `ArcFormats/PkWare/ArcZIP.cs`, class `ZipOpener`
- GARbro tag: `ZIP`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARbro author and copyright: Copyright (c) 2014-2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior. GARbro delegates
ZIP parsing to SharpZipLib; this port walks the central directory directly and streams entries with
Node's inflate-raw.

## Structure

ZIP archives end with an "end of central directory" record (`PK\x05\x06`) that stores the entry
count, the central directory size, and the central directory offset. Detection scans the last
0x10016 bytes for that signature, matching GARbro's `SearchForSignature`.

Each central directory record (`PK\x01\x02`) stores the general purpose flags, the compression
method, the CRC-32, packed and unpacked sizes, the name, and the local header offset. ZIP64 records
(`PK\x06\x06` / `PK\x06\x07`) and ZIP64 extra fields are honored when the classic 32-bit fields
overflow.

Names are decoded as UTF-8 when general purpose flag bit 11 is set and as CP932 otherwise, matching
GARbro's default `ZIPEncodingCP` setting of 932.

Extraction supports:

- method 0 (stored), streamed directly from the local header payload;
- method 8 (deflate), streamed through inflate-raw;
- method 12 (bzip2), read with the walk of that format this project carries (`packages/codecs/src/bzip2.ts`),
  since the stream a method twelve entry holds is a whole bzip2 file. The count of the places of a file it
  reads back is checked against the head of the entry, where the reference leaves that to its library;
- entries whose local header carries a data descriptor, because sizes come from the central
  directory.

Directory records (names ending in `/`) are skipped. Encrypted entries are listed with
`encrypted: true` and extraction reports an explicit unsupported-feature error.

## Support

| Capability | Status |
| --- | --- |
| End-of-central-directory detection | Supported |
| Stored and deflate entries | Supported |
| ZIP64 end records and extra fields | Supported |
| CP932 and UTF-8 names | Supported |
| Directory record skipping | Supported |
| Streaming extraction | Supported |
| Encrypted entry metadata | Supported |
| Encrypted entry extraction | Unsupported |
| bzip2 entries (method 12) | Supported |
| Other compression methods (LZMA, ...) | Unsupported |
| Archive creation | Unsupported |

Fixtures cover stored and deflated entries, directory records, CP932 and UTF-8 names, the bzip2 method (of an
archive Python's own `zipfile` wrote, so an implementation of that format outside this project stands behind
it) and its refusal of a stream that stands of no count of its own, and the encrypted-entry rejection path. A PowerShell `Compress-Archive` archive was verified manually.
