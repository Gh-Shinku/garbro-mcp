# ads engine PAC archive

## Reference and attribution

- GARBro reference: `ArcFormats/Ads/ArcPAC.cs`, classes `PacOpener`, `IndexReader`, `RleDecompressor`
  and `AdsEntry`
- GARbro tag: `PAC/ADS`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARbro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The archive needs a `pac` extension and an index region whose length is the first word of the file; that
region must be at least 0x110 bytes and must end inside the volume, because every data offset is validated
against the volume rather than the index. The directory tree starts at offset 4.

A directory begins with a count of subdirectories and a count of files, bounded at 0x200 and 0x40000.
Only the root carries a name, which the reference reads, validates and then discards — the port keeps that
behavior, which matters because a nested directory that stored a name would shift every following record.
Names occupy fixed 0x104-byte slots whose bytes are stored bitwise inverted, and the reader consumes each
whole slot, which is what pins the record stride. A file record then holds the stored size, the data
offset and the compression method; a subdirectory record holds the offset of its own directory and its
name, and the offset is validated against the index length. Names are joined with a forward slash, and
subdirectories are recursed into after the whole record list has been read.

Extraction decompresses only method one. Any other non-zero method leaves its payload verbatim even
though the reference still calls the entry packed, and the port keeps that distinction. The RLE stream is
a sequence of chunks, each starting with a control byte: zero introduces a literal run whose length is
however many bytes the next read returned, at most three, while a non-zero value repeats the pattern left
in that three-byte buffer a stored count minus one times. The reference reuses one buffer for both
branches, so a literal run shorter than three bytes leaves stale pattern bytes for a later repeat, and the
port reproduces that. Because the decompressor declares no output length and ends at the end of the
stream, RLE entries are marked as having an inexact size.

## Support

| Capability | Status |
| --- | --- |
| `pac` extension requirement | Supported |
| Index size bounds | Supported |
| Directory tree with both counts | Supported |
| Root-only name that is read and discarded | Supported |
| Fixed 0x104-byte inverted name slots | Supported |
| File records with size, offset and method | Supported |
| Data offset validated against the volume | Supported |
| Subdirectory recursion with slash-joined names | Supported |
| CP932 names | Supported |
| Stored payloads | Supported |
| RLE payloads (method 1) with the shared pattern buffer | Supported |
| Verbatim payloads for other non-zero methods | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover nested directories with inverted name slots, an RLE payload, the extension
requirement, and an index size outside the file.
