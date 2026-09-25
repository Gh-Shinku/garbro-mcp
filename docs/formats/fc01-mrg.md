# F&C Co. engine MRG resource archive

Reference: `GARbro/ArcFormats/FC01/ArcMRG.cs`, class `MrgOpener` (the Overture variant `Mrg2Opener`
of the same file is a separate record; the `MrgDecoder` codec of methods two and three stands in
`packages/formats/src/fc01/mrg-decoder.ts`) (GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/fc01/mrg.ts` (`mrgDescriptor`, `mrgFormat`, id `fc01-mrg`).

## Header and index

| Offset | Size | Meaning |
|--------|------|---------|
| `0x00` | 4 | `MRG\0` |
| `0x04` | 2 | first key table index (`u16`) |
| `0x06` | 2 | second key table index (`u16`) |
| `0x08` | 4 | index size plus `0x10` |
| `0x0C` | 4 | entry count (`i32`) |
| `0x10` | index size | records |

Detection needs a sane count, a first key index whenever the second one is not zero, a second key
index below two, and an index size of at least `0x40` that stays below the file size. The index is
encrypted as a whole; the key is guessed, not stored.

Records are `0x20` bytes apart, but the end offset lives at `+0x3C`, so a record reaches into the
next one and the two fields are shared:

| Offset | Meaning |
|--------|---------|
| `+0x00` | name, cp932, up to `0x0E` bytes |
| `+0x0E` | unpacked size (`u32`) |
| `+0x12` | method (byte) |
| `+0x1C` | start offset of this entry (`u32`) |
| `+0x3C` | end offset of this entry, which is the start of the next one (`u32`) |

The start of the first entry comes from the first record's `+0x1C` field. Every entry must start at
or after the index and pass the placement check. The last record's end offset is the file size, and
that is exactly what makes the key guess work: the guess reconstructs the last offset from the four
bytes at the end of the index and accepts the key only when it equals the file size.

## Key guess and decryption

`GuessKey` rotates the last index byte left by one, XORs it with the top byte of the file size and
then walks three bytes back, subtracting 2, 3 and 4 from the key candidate as it re-reads each byte
the same way. Rebuilding the last offset from those four values must reproduce the file size. The
remaining key steps walk back to the beginning of the index, subtracting 5 up to the index length,
which leaves the key that was used for the first byte. Not finding a key declines the archive
instead of raising the reference's `UnknownEncryptionScheme`.

`Decrypt` rotates each byte left by one, XORs it with the current key and then advances the key by
the number of bytes that are still to come, so the key schedule depends on the total length:

```text
data[i] = RotByteL (data[i], 1) ^ key
key     = key + length   (with length decreasing by one per byte)
```

## Payload methods

| Method | Storage |
|--------|---------|
| `0` | stored, extracted verbatim |
| `1` | LZSS, extracted through the format's own reader |
| `2` | `MrgDecoder` then LZSS |
| `3` | `MrgDecoder` only |
| above `3` | stored, extracted verbatim |

The LZSS reader is a sliding window variant: control bits are read least significant bit first, a set
bit copies one literal, and a clear bit reads a 16 bit little endian word where the top nibble plus
three is the byte count and the low twelve bits are the frame index. The frame is `0x1000` bytes and
zero filled, and writing starts at `0xFEE`. This does **not** match GARbro's shared `LzssReader`
(which splits an offset differently), so the reader is implemented inside this format.

## Deviations

* The `MrgDecoder` walk of a count of the places of the file of the head of it stands of the count of
  the places of the walk of the picture, of the two words of the head of it the other way round; the
  counts of the cells of the table of the walk stand of the counts of the places of the file of the
  picture, and every count stands of the places of the file alone, of no count of the places of the
  picture above `0x10000` of them. A walk of the codec of nought places the table stands of no count of
  the places of the file and is refused with `INVALID_ARCHIVE`, of the reference's own refusal of it.
* Methods two and three stand of the walk of the codec of the engine; a payload of less than `0x108`
  places of the file is handed over as it stands, as the reference hands it over.
* The reference throws `UnknownEncryptionScheme` when the key guess fails; the port declines the
  archive so that probing never throws.
* Archive creation is out of scope.
