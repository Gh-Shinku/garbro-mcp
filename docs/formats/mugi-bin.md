# Mugi's BIN resource archive

## Reference and attribution

- GARBro reference: `ArcFormats/Mugi/ArcBIN.cs`, class `BinOpener`, with `ArcFormats/LzssStream.cs`
- GARBro tag: `BIN/MUGI`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARbro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The file opens with a fixed 0xC000-byte index region: names of 0x10 bytes each starting at 0, a table
of data offsets at 0x8000, and the unpacked sizes at 0xA000. Each table has room for 0x800 entries,
which is also the bound GARbro puts on the archive.

The first offset must equal the end of the index region, and the offset table is then walked until a
value equals the file size. Every value must be non-decreasing and may not exceed the file, and the
value that ends the walk also becomes the last entry's end boundary, so the entry count is one less
than the number of values read. Sizes are the gaps between consecutive offsets and therefore cannot be
read from the index.

An entry is compressed when its stored size differs from its declared unpacked size, and those payloads
are decoded as LZSS streams with GARbro's `LzssStream` defaults, which are also the defaults of
`@garbro-mcp/codecs`. The format has neither a signature nor an extension, so the fixed layout is the
detection.

## Support

| Capability | Status |
| --- | --- |
| Fixed 0xC000-byte index layout | Supported |
| First offset equal to the index end | Supported |
| Non-decreasing offset walk terminated by the file size | Supported |
| 0x800-entry bound | Supported |
| Derived sizes from offset gaps | Supported |
| Unpacked size table | Supported |
| Packed detection from size inequality | Supported |
| LZSS extraction with GARbro's default settings | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover a plain and a packed entry, a wrong first offset, a decreasing offset, and a
file holding only the index region.
