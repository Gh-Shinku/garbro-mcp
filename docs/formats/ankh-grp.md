# Ice Soft GRP/ICE resource archive

## Reference and attribution

- GARBro reference: `ArcFormats/Ankh/ArcGRP.cs`, class `GrpOpener` and the `GrpUnpacker` bit-stream decoder
- GARBro tag: `GRP/ICE`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The first word is both the offset of the first payload and the end of a word-aligned offset table that follows the
four-byte table header, so the entry count is derived from it and the table holds one offset per entry. Every entry spans
from its own table word to the next one — the file end for the last entry — and is named `<archive>#<index>` with a
four-digit index. Zero-length ranges are skipped, but they still consume an index, and every placement is validated.

## Payload detection

Every payload longer than eight bytes is inspected through a reused sixteen-byte header, so a short read leaves the
previous entry's bytes in place exactly as the reference does. The inspection recognizes the archive's own containers
first:

| Marker | Meaning | Effect |
| --- | --- | --- |
| `TPW` with a non-zero fourth byte | Folded bitmap | Unpacked size from 0x04, decoded with the TPW decoder |
| `TPW` with a zero fourth byte | Stored payload | Four-byte marker skipped |
| `HDJ\0` at 0x04 | Packed image | Unpacked size from 0x00, decoded with the HDJ decoder |
| `zfd ` | Deflated image | Unpacked size from 0x04, deflated from 0x08 |
| `OggS` at 0x04 | Inline Ogg | Four-byte prefix skipped, entry renamed `.ogg` |
| `RIFF` at 0x08 with `W` at 0x04 | Packed samples | Header copied in front of ADPCM or sample data |
| `RIFF` at 0x05 behind a 0xFN byte | LZSS stream | Decoded as a GARbro LZSS stream |
| anything else | Detected type | Catalog special cases, MP3 frame sync, or a raw PCM layout test |

Detected types follow `Entry.ChangeType`, which sets the entry type and renames it to the resource's first extension.

## Bit-stream decoding

`GrpUnpacker` caches a whole little-endian word and hands out bits from its most significant end, so within every
four-byte group the first bit lives in the last byte's high bit. The HDJ decoder also keeps its own literal and match
word caches read from the same stream, so both readers interleave on one cursor.

Because several games share the same headers with slightly different layouts, the decoder keeps a process-wide variant
choice: HDJ decoding tries the remembered variant, falls back to the other one when the attempt fails, and remembers the
one that worked; S decoding uses the same scheme but accepts a variant only when it consumes the stored stream exactly,
and silently returns the partially decoded buffer when neither fits. Only the HDJ retry treats a second failure as fatal.

- **HDJ** — a leading bit selects a literal byte from the byte cache or a match. Matches come in two flavours: a word
  cache giving a thirteen-bit distance and a three-bit length, or a byte cache giving an eight-bit distance and a two-bit
  length. A length of ten, respectively five, extends through a unary bit count and that many extra bits. The two
  variants differ in whether the short count is read before or after the byte cache refill.
- **S** — the default variant decodes per channel with delta or absolute words and run-length zeroes; the BoD variant
  decodes a single stream of delta or absolute words.
- **A** — one absolute ten-bit value per channel step, needing no bit cache of its own.

TPW payloads use a separate control byte decoder whose header seeds three copy distances and whose controls copy literals,
repeat one byte, repeat two- or three-byte patterns, or copy from one of the seeded distances.

## Support

| Capability | Status |
| --- | --- |
| Word-aligned first offset and derived entry count | Supported |
| Offset-table walk with file-end terminator | Supported |
| `<archive>#<index>` naming and zero-size skipping | Supported |
| TPW container, folded and stored | Supported |
| HDJ container with variant retry | Supported |
| zfd deflate container | Supported |
| Inline Ogg and RIFF payloads | Supported |
| Packed samples (ADPCM and sample packing) | Supported |
| MP3 frame sync and raw PCM layout typing | Supported |
| Entry type and extension retyping | Supported |
| Entry placement validation | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the offset table, a folded and a stored TPW payload, an HDJ literal payload, a deflated payload,
an inline Ogg payload, an inline LZSS RIFF payload, packed PCM samples, an unrecognized payload, an unaligned first
offset, a backwards table and an archive without entries.
