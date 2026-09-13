# LiveMaker resource archive (DAT/vf)

## Reference and attribution

- GARbro reference: `ArcFormats/LiveMaker/ArcVF.cs`, classes `VffOpener`, `VfEntry`, `TpRandom`,
  `TpScramble`
- GARbro tag: `DAT/vf`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

## Detection

The archive header starts with the four bytes `vff\0`. Three layouts are accepted:

- a `.dat` file that carries the header itself;
- a `.dat` file whose header is broken, in which case the index is read from a sibling file with the
  extension replaced by `.ext` (that file repeats the header);
- an `.exe` file whose header is a DOS `MZ` signature, in which case the archive starts behind the last
  section of the executable and is read from the overlay.

GARbro also lists a zero signature, so any file reaches the detection function; the extension and the
header are what actually decide. Directories are supported and the archive may continue in numbered parts.

## Layout

```
+0  char[4] "vff\0"
+4  uint16  version, unused by the reader
+6  int32   entry count
+A  record[] name and index records
```

The index follows the header and holds three runs:

```
+0     record[]  per entry: uint32 length, then that many scrambled name bytes
+next  int64[]   entry count plus one scrambled offsets, little endian
+next  byte[]    one flag byte per entry
```

Names are scrambled with `TpRandom`, an eight bit stream of a linear congruential generator seeded with
`0x75D6EE39`: every name byte is XORed with the low byte of the next draw, and the generator restarts
before the offsets. Offsets are read as signed 64-bit values and XORed with the sign extended 32-bit draw,
then shifted by the base offset of the archive. The first offset is the start of the first entry and each
following offset ends the previous entry, so the last offset ends the archive.

The port fills the truncated final chunk of every scrambled entry instead of faulting, and it rejects
entries that leave the archive, which the reference does not check.

## Extraction

Flags decide how an entry is unpacked:

| Flag | Meaning |
| --- | --- |
| 0 | Deflate compressed |
| 1 | Stored verbatim |
| 2 | Scrambled chunks |
| 3 | Scrambled chunks and deflate compressed |

A scrambled entry opens with an eight byte header naming the chunk size and the shuffle seed, and the
chunks that follow are stored in a draw order produced by `TpScramble`, a five word multiply with carry
generator. Extraction restores the chunk order and then inflates when the entry is also compressed. The
reference undoes the scrambling before inflating, so scrambled and compressed entries store the scrambled
form of the deflate stream. Entries of eight bytes or less produce an empty stream.

Scrambled entries lose the eight byte shuffle header, and compressed entries grow back to their unpacked
size, which is only known after decompression, so both report an unknown size.

## Port notes and deviations

- Archive creation is out of scope.
- Entry offsets are checked against the combined size of the main file and its parts.
- A range that spans several parts is buffered before it is unscrambled, because the shuffle needs the
  whole entry. Ranges that stay in one file are read directly.
- The index is read into memory with an upper bound derived from the entry count, so a truncated index is
  declined instead of throwing.

## References

- `GARbro/ArcFormats/LiveMaker/ArcVF.cs` - `VffOpener.TryOpen`, `VffOpener.ReadIndex`,
  `VffOpener.DecryptName`, `VffOpener.OpenEntry`, `VffOpener.ReshuffleStream`,
  `VffOpener.RandomSequence`, `TpRandom`, `TpScramble`
