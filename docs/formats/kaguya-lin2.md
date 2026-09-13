# KaGuYa script engine resource archives (LIN2)

## Reference and attribution

- GARBro reference: `ArcFormats/Kaguya/ArcLIN2.cs`, class `Lin2Opener`
- GARBro tag: `ARC/LIN2`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior. The sibling `UF01` opener
from the same engine is documented in `kaguya-uf.md`.

## Signature and index

`LIN2` marks the format, followed by a sane 32-bit entry count at 0x04. Records run sequentially from 0x08:

| Field | Size | Meaning |
| --- | --- | --- |
| Name length | 2 | |
| Name | length | CP932, exclusive-ored with 0xFF |
| Offset | 4 | Absolute payload offset |
| Stored size | 4 | |
| Type | 2 | 1 = packed, 2 = audio |

Every name byte is exclusive-ored with 0xFF, and the name ends at its first NUL inside the field. An empty
name rejects the archive. The format is not hierarchical, so backslashes stay part of the name. The type
word survives as metadata: a type of 2 marks an audio entry.

## Payload handling

A packed payload is a 32-bit unpacked size followed by the compressed stream, and the index's stored size
covers both. The reference reads that size while extracting; the port resolves it while listing, so a
listing reports the unpacked size and extraction decodes to it.

The codec is **not** the engine-default LZSS variant:

- control bits are read from the most significant bit down, and a new control byte is read every eight
  commands;
- a match reads an offset byte and a length nibble, biased by two;
- **two consecutive matches share one count byte** — the first match uses its low nibble, the second the
  high nibble, and no further byte is read for it;
- the 0x100-byte ring starts at position 0xEF, and copies may overlap, so a match can read bytes it has
  just written.

Because the output length is declared, the decoder allocates it up front. Running out of input at a control
boundary ends the stream cleanly and leaves the remainder zeroed, which mirrors the reference; running out
in the middle of a literal or match raises an error, where the reference's `ReadUInt8` would throw as well.

## Support

| Capability | Status |
| --- | --- |
| `LIN2` signature and the entry count | Supported |
| 16-bit name lengths, 0xFF-masked names and first-NUL decoding | Supported |
| Type words for packed and audio entries | Supported |
| Payload offsets, stored sizes and placement checks | Supported |
| Packed payload prefixes with the unpacked size | Supported |
| Format-specific LZSS variant with MSB-first control bits | Supported |
| Shared match count nibble and overlapping copies | Supported |
| Truncation errors | Supported |
| Extension-based entry typing | Unsupported |
| Archive creation | Unsupported |

Synthetic fixtures cover stored, audio and packed entries, a match that copies from bytes it has just
written, a name whose field holds padding behind its terminator, a name with a backslash, an empty name, a
foreign signature, an insane entry count, a record that reaches past the archive, a payload outside the
archive, and a packed payload whose stream runs out.
