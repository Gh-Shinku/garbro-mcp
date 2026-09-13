# Libido ARC resource archive

## Reference and attribution

- GARBro reference: `Legacy/Libido/ArcARC.cs`, class `ArcOpener`
- GARBro tag: `ARC/LIBIDO`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2018 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARBro behavior.

## Structure

The archive has no signature. A signed 32-bit entry count starts at offset zero and is followed at offset four by
0x20-byte records: a 0x14-byte CP932 name, unpacked size, stored size, and absolute payload offset. GARBro treats
the entire archive as name-obfuscated when the first raw name field contains `0xff`; every name field is then XORed
with `0xff` before decoding. Empty names, surviving `0xff` bytes, offsets inside their own index record, and payloads
outside the file reject the archive.

## Extraction

An entry whose stored and unpacked sizes differ is decoded as a default GARBro LZSS stream; other entries are emitted
verbatim. Name obfuscation is reflected in entry metadata as encryption, but payloads are not encrypted.

## Support

| Capability | Status |
| --- | --- |
| Fixed 0x20-byte index records | Supported |
| Plain and XOR-obfuscated CP932 names | Supported |
| Index and payload placement validation | Supported |
| Default LZSS extraction | Supported |
| Verbatim extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover encrypted names, stored and LZSS payloads, and an offset overlapping the archive header.
