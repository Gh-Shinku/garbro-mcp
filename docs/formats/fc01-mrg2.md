# Overture engine MRG resource archive

Reference: `GARbro/ArcFormats/FC01/ArcMRG.cs`, class `Mrg2Opener` (the Overture variant of the same
file as the F&C `MrgOpener`, which is a separate record; the `MrgDecoder` codec of methods two and
three stands in `packages/formats/src/fc01/mrg-decoder.ts`) (GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/fc01/mrg2.ts` (`mrg2Descriptor`, `mrg2Format`, id
`fc01-mrg2`).

## Header and index

| Offset | Size | Meaning |
|--------|------|---------|
| `0x00` | 4 | `MRG\0` |
| `0x06` | 2 | version, at least two |
| `0x08` | 4 | index size plus `0x10` |
| `0x0C` | 4 | entry count (`i32`) |
| `0x10` | index size | records |

The `u16` at `0x06` is the second key index of the F&C layout, so the two openers share the
signature without overlapping: the older one declines from two upwards, this one below two.
Detection needs a sane count and an index size of at least `0x40` that stays below the file size.

Records are `0x57` bytes apart and their end offset reaches into the next record, exactly like the
F&C layout:

| Offset | Meaning |
|--------|---------|
| `+0x00` | name, cp932, up to `0x40` bytes |
| `+0x41` | unpacked size (`u32`) |
| `+0x45` | method (`u16`) |
| `+0x4F` | start offset of this entry (`u32`) |
| `+0xA6` | end offset of this entry, which is the start of the next one (`u32`) |

The start of the first entry comes from the first record's `+0x4F` field. Unlike the F&C layout this
one only checks placement against the end of the file.

## Mask table

Both the index and the stored payloads are masked with a 256 byte table generated from two values,
a name checksum and a key:

```text
for i in 0..255:
    n          = key + RotL32 (checksum, 16)
    key        = checksum
    checksum   = checksum + n
    table[i]   = checksum & 0xFF

data[i] ^= table[i & 0xFF]
```

The index uses the checksum of the archive file name (uppercase folding, dots skipped) together
with the constant `0x285EE76F`. A stored entry uses the checksum of its own name as the seed and the
archive checksum as the key — the opposite assignment of the index call, which is easy to get wrong.

`GetNameChecksum` starts from the case folded first character and then adds every character except
dots with a left shift of six: `checksum = checksum + char + (checksum << 6)`.

## Payload methods

| Method | Storage |
|--------|---------|
| `0` | stored but masked, extracted after the table is applied |
| `1` | LZSS, extracted through the reader of the F&C layout |
| `2` | `MrgDecoder` only |
| `3` | `MrgDecoder` then LZSS |
| above `3` | stored, extracted verbatim |

The LZSS reader is shared with `packages/formats/src/fc01/mrg.ts`; see that document for the frame
semantics.

## Deviations

* Methods two and three stand of the walk of the codec of the engine: method two of the walk of it
  alone, method three of the walk of it and of the walk of the words behind it. The reference stands of
  the walk of the codec of a payload of no count of the places of the file of it and throws; the port
  refuses it with `INVALID_ARCHIVE`.
* Archive creation is out of scope.
