# Flying Shine PD version 2 resource archive

Reference: `GARbro/ArcFormats/FlyingShine/ArcPD.cs`, class `FlyingShinePdOpener`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/flying-shine/pd2.ts` (`flyingShinePd2Descriptor`,
`flyingShinePd2Format`, id `flying-shine-pd2`).

## Header and index

| Offset | Size | Meaning |
|--------|------|---------|
| `0x00` | 4 | `Flyi` |
| `0x04` | 13 | `ngShinePDFile\0` |
| `0x12` | 2 | unused crc (`u16`) |
| `0x14` | 1 | record key |
| `0x1C` | 4 | entry count (`i32`) |
| `0x20` | 0x30 × count | masked records |
| `0x20 + 0x30 × count` | | payload area |

Apart from the four byte signature (which the registry gates on), the long marker must follow at
offset 4, the count must pass `IsSaneCount`, and the record table must fit inside the file.

Every record is masked: all `0x30` bytes are XORed with the key byte from offset `0x14`. Inside the
decoded record a NUL terminated cp932 name occupies the first `0x24` bytes (an empty name or one
without a terminator declines the archive), followed by a `u32` shift at `0x24`, the payload offset
at `0x28` and the payload size at `0x2C`. Both numeric fields are stored with the shift added, so the
offset and the size are the stored words minus the shift (a 32 bit subtraction, which wraps like the
reference's `uint` arithmetic); every entry passes `checkPlacement`.

## Extraction

* `.ogg` entries larger than `0x22` bytes whose first `0x23` bytes look like a Vorbis identification
  page (`OggS`, a clear flag byte at `0x1A`, `0x1E` at `0x1B`, `0x01` at `0x1C` and `vorbis` at
  `0x1D`) get the flag byte at `0x1A` set to one; everything else is copied verbatim. The rewrite is
  length preserving.
* `.def` and `.dsf` entries of at least two bytes derive a key from their last byte
  (`key = last ^ 0x0A`) and, when the byte before it satisfies `prev ^ key == 0x0D`, XOR the whole
  payload with that key. The two trailer bytes stay part of the output, as in the reference.
* Any other entry is extracted verbatim.

## Deviations

* The crc word at offset `0x12` is read by the reference but never used, so it is not validated.
* The `PD` and `PD/3` tags live in the same reference file but are separate status records.
