# C's ware DL1 resource archive

## Reference and attribution

- GARBro reference: `Legacy/Aaru/ArcDL1.cs`, class `Dl1Opener`, with `ArcFormats/LzssStream.cs`
- GARbro tag: `DL1`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARbro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The file starts with `DL1.0` and a 0x1A byte. The entry count sits at 8 and a word at 0xA points at the
index. Payloads begin at 0x10 and follow each other in index order, so an entry's offset is the running
sum of the sizes before it rather than a value stored in the record.

Records are 0x10 bytes wide: a 0xC-byte name field and the stored size. `Dl1Opener.OpenEntry` marks an
entry as packed when its payload starts with `LZ`, reads the unpacked size from the word at +6, and
decodes the LZSS stream that begins at +10 using GARbro's `LzssStream` defaults, which are also the
defaults of `@garbro-mcp/codecs`. The port performs that inspection while reading the index so listing
and extraction agree, and marks those entries as having an inexact size because the decoder stops at
the end of the stored stream. This layout shares its engine family with the CsWare ARC2 archive, which
has its own note and port.

## Support

| Capability | Status |
| --- | --- |
| `DL1.0` header with its 0x1A byte | Supported |
| Entry count validation | Supported |
| Index offset bound | Supported |
| Sequential payload offsets | Supported |
| Fixed 0xC-byte name field with a 0x10-byte record | Supported |
| CP932 filenames | Supported |
| Entry placement validation | Supported |
| `LZ` detection with the unpacked size word | Supported |
| LZSS extraction with GARbro's default settings | Supported |
| Verbatim extraction for other payloads | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover a stored and an `LZ` payload, a foreign header, an index offset beyond the file,
and an empty entry count.
