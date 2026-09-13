# SPack resource archive

## Reference and attribution

- GARBro reference: `ArcFormats/ArcSPack.cs` (`DatOpener`, `PackedReader`) with `NotTransform` from
  `ArcFormats/SimpleEncryption.cs`
- GARbro tag: `SPACK`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARbro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The head spells `SPack`: the signature covers `SPac`, the byte at 4 must be `k` and a null byte follows
it, and the version word at 6 must be one. A data size sits at 8 and the entry count at 0x10, bounded at
0xFFFFF. Payloads start at 0x18 and the index follows them at `0x18 + data_size`.

Every record is 0x38 bytes: a 0x20-byte name field, then a data offset relative to 0x18, the unpacked
size, the stored size, a method byte, a padding byte, and a CRC word. GARbro records the CRC without ever
verifying it, and the port does the same.

Extraction is selected by the method. Zero copies the stored bytes. One inverts them, because the
reference wraps that case in its `NotTransform`. Two runs the LZ unpacker — the only method with real
logic: tokens are read against a 32-bit little-endian control word whose most significant bit flags the
first token, a set bit introduces a match, a match's first byte holds a count nibble and an offset
nibble, counts above thirteen are extended by a byte or a word, offsets of ten and above are extended by
a further byte while smaller ones are stored as one less than their real distance, and copies overlap
byte by byte and are clamped to the declared output length. Any other method falls back to a verbatim
copy.

## Support

| Capability | Status |
| --- | --- |
| `SPack` head with its marker and version | Supported |
| Entry count bounds | Supported |
| Index at `0x18 + data size` with 0x38-byte records | Supported |
| Relative data offsets and both size words | Supported |
| Method byte and CRC word | Supported, CRC recorded but not verified |
| Entry placement validation | Supported |
| Stored payloads (method 0) | Supported |
| Inverted payloads (method 1) | Supported |
| LZ payloads (method 2) | Supported |
| Verbatim fallback for other methods | Supported |
| `*.dat` audio classification | Supported as metadata |
| Archive creation | Unsupported |

Synthetic fixtures cover stored, inverted, and LZ payloads, a version other than one, a missing marker
byte, and a payload outside the file.
