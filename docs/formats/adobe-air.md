# Adobe AIR resource archive

## Reference and attribution

- GARBro reference: `ArcFormats/Adobe/ArcAIR.cs`, class `DatOpener`
- GARBro tag: `DAT/AIR`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2019 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

An AIR archive starts with a big-endian offset to its index, which must stay inside the file and
below GARbro's 1 MiB index cap. The index is a raw-deflate stream that begins with `0a 0b 01`;
records follow as a flagged name length (the low bit is always set and the rest is the byte count),
the UTF-8 name, the `09 05 01` marker, and two unsigned variable-length integers behind `04` markers
holding the data offset and the compressed size. A zero name length ends the index.

Both integers use GARbro's `ReadInteger` encoding: seven bits per byte with the high bit marking a
continuation, and a final byte that is taken whole. Payloads are raw-deflate streams, so their
extracted size is not declared anywhere. Entries therefore keep the stored size and are flagged with
`sizeKnown: false`, which lets extraction report the real byte count instead of failing a length
check.

## Support

| Capability | Status |
| --- | --- |
| Index offset and size validation | Supported |
| Raw-deflate index inflation | Supported |
| Flagged name lengths and UTF-8 names | Supported |
| Variable-length integers | Supported |
| Zero-length index terminator | Supported |
| Raw-deflate payload streaming | Supported |
| Undeclared output sizes | Supported |
| Entry placement validation | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the index layout, both integer forms, payload streaming, end-to-end
extraction of an entry whose size is not declared, and index rejection.
