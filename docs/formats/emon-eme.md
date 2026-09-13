# Emon Engine resource archive (EME)

## Reference and attribution

- GARbro reference: `ArcFormats/EmonEngine/ArcEME.cs`, classes `EmeOpener`, `EmEntry`, `EmeArchive`,
  `EmMetaData`
- GARbro tag: `EME`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

## Detection

The file starts with the eight byte signature `RREDATA `. The last four bytes hold the entry count, the
entry table sits in front of them and the forty byte decrypt key sits in front of the table. The key is
only accepted when the table is large enough to fit in the file, when every count is sane and when every
entry stays inside the file.

## Layout

```
+0                         char[8]  "RREDATA "
+8                         byte[]   entry payloads
index_offset - 40          byte[40] decrypt key
index_offset               record[] 0x60 bytes per entry
MaxOffset - 4              int32    entry count
```

Every index record is decrypted before it is read, with the single archive key.

```
+0x00 char[0x40]  NUL terminated name
+0x40 uint16      LZSS frame size, zero when the entry is not LZSS packed
+0x42 uint16      LZSS frame start, stored as frame_size - position
+0x48 int32       subtype: 3 script, 4 image, 5 header wrapped
+0x4C uint32      stored size
+0x50 uint32      unpacked size
+0x54 uint32      offset
```

An entry is only accepted when its stored size stays inside the file. The four bytes trailing every
record and the second half of the frame fields are not used by the reference.

## Decryption

`EmeOpener.Decrypt` is an eight step bytecode. The first eight bytes of the key are opcodes and the
remaining thirty two bytes are eight little endian words, consumed back to front. Opcodes are applied
from step seven down to step zero.

| Opcode | Operation |
| --- | --- |
| 1 | XOR every word with the step key |
| 2 | XOR every word with the previous plaintext word, seeded with the step key |
| 4 | Spread the bits of every word by repeatedly adding the signed step key to a shift amount |
| 8 | Transpose the bytes of the record with a step of the signed step key, wrapping at the record size |

The port reproduces two quirks of the reference: the shift amount of opcode 4 is masked to five bits,
which is what C# does with a shift count of thirty two or more, and a negative step key can push opcode 8
outside the record, in which case the misplaced byte is dropped instead of faulting.

## Extraction

- **Scripts (subtype 3)** start with a twelve byte header that is decrypted the same way as the index.
  Without a frame size the decrypted header is prefixed to a read of the stored size from behind the
  header. With a frame size the header holds a packed size and a trailing part size: when the trailing
  part is non-zero and shorter than the unpacked size, the tail of the entry and the head of the entry are
  decoded separately and concatenated, otherwise the whole entry after the header is decoded as one
  stream. The frame size and frame position configure the shared LZSS decoder.
- **Subtype 5** entries have their first four bytes decrypted and prefixed to the rest of the entry.
- **Everything else**, including images, is stored verbatim, even when the record claims a different
  unpacked size.

Entry sizes are only certain for entries that are stored verbatim. Scripts are rebuilt into a stream of a
different length, so they report an unknown size.

## Port notes and deviations

- Archive creation is out of scope.
- The Emon Engine image decoder (subtype 4 images) is out of scope; those entries extract verbatim.
- The single stream script branch is decoded to the end of its input instead of stopping at the declared
  unpacked size, which matches the unbounded stream the reference returns. Because the reference reads
  the stored size from behind the twelve byte header, the decode can include trailing bytes.
- A frame size that is not a power of two is rejected by the shared LZSS decoder, while the reference
  would silently use a broken frame mask.

## References

- `GARbro/ArcFormats/EmonEngine/ArcEME.cs` - `EmeOpener.TryOpen`, `EmeOpener.OpenEntry`,
  `EmeOpener.OpenScript`, `EmeOpener.OpenT5`, `EmeOpener.Decrypt`, `EmeOpener.ShiftValue`,
  `EmeOpener.InitTable`
