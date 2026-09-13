# Triangle BMX resource archive

## Reference and attribution

- GARBro reference: `ArcFormats/Triangle/ArcBMX.cs`, class `BmxOpener`
- GARBro tag: `BMX/TRIANGLE`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The archive has no signature. A signed entry count sits at offset zero and `count + 1` offsets follow: the first must
equal the index size and the last must equal the file size, so the table describes a gapless run of payloads with a
trailing sentinel. Extensions are `bmx`, `wax`, `fx` and `gx`. Entries are named `<archive>#<index padded to 4>`;
archives named `fx` or `gx` classify every entry as audio or image from the filename alone.

## Extraction

`BmxOpener.OpenEntry` sets the packed flag lazily when an entry starts with `fACE`. The unpacked size is the following
word XORed with `0x65641538`, and the payload behind the eight-byte header is decoded with the Triangle LZ codec
(`TriFormat.Unpack`): a 32-bit control word is consumed from its high bit, a clear bit reads a literal that is XORed
into a running key, and a set bit reads a 16-bit word whose low twelve bits give a match distance and whose high nibble
plus two gives the copy length. A zero high nibble selects a long form whose length byte is biased by the previous key;
a byte that cancels that key ends the stream. Copies overlap and run forward.

The port performs the packed inspection while reading the index so listing and extraction agree. Entries without the
`fACE` marker are emitted verbatim, including the ones that are too short to carry the header. GARBro's content-based
type inference (`AutoEntry.DetectFileType`) is not reproduced, and TRI bitmap decoding is not implemented.

## Support

| Capability | Status |
| --- | --- |
| Count with offset table and file-size sentinel | Supported |
| Gapless payload walk with placement validation | Supported |
| Derived `<archive>#<index>` names | Supported |
| `fx` and `gx` filename type defaults | Supported |
| `fACE` marker with XOR-masked unpacked size | Supported |
| Triangle LZ extraction | Supported |
| Verbatim extraction | Supported |
| Entry type inference by content | Unsupported |
| TRI bitmap decoding | Unsupported |
| Archive creation | Unsupported |

Synthetic fixtures cover stored and packed entries, literal and match decoding across two control words, filename type
defaults, and first-offset and sentinel rejection.
