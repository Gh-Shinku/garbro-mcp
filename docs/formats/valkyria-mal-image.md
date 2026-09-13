# Valkyria MAL mask

Reference: `GARbro/ArcFormats/Valkyria/ImageMAL.cs`, class `MalFormat`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/valkyria/mal-image.ts` (`malImageDescriptor`, `malImageFormat`, id
`valkyria-mal-image`).

| field | offset |
|---|---|
| signature `MICO` | 0 |
| marker `MSK00` | 4 |
| width (`u16`) | 0x0A |
| height (`u16`) | 0x0C |
| packets | 0x0E |

`ReadMetaData` reads fourteen bytes, requires `MSK00` at offset four and takes the dimensions from the last
four; the depth is always eight. A wrong marker is declined, so a test with `MSK01` shows the marker is really
checked.

## The packet stream

The stream is a sequence of sixteen bit counts:

* a count **above 0x7FFF** carries raw bytes in its low fifteen bits, so `0x8000` is a raw run of no bytes at
  all — an edge a test pins, because the test is "above 0x7FFF" and not "at least 0x8000";
* any other count is followed by **one byte to repeat that many times**, and a count of zero is harmless: it
  consumes a byte and writes nothing.

The reference allocates **fifteen bytes more than the image needs**, and three of its behaviours follow from how
it uses that buffer. All three are ported and tested:

* a **repeat** may reach up to fifteen bytes past the end, writing into the slack; only the first `width * height`
  bytes reach the bitmap, so the slack is invisible in the output. A test repeats six bytes into a four pixel
  image and expects four;
* a repeat that reaches **further** than fifteen bytes throws, which is what writing past the end of a
  `byte[]` does in the reference. The same four pixel image with a run of twenty fails;
* a **raw run** that runs out of stream copies what there is — the reference does not check what `Read`
  returned — and still moves the write position by the count it asked for, leaving the rest of the image zero. A
  test announces eight bytes, stores three and expects `01 02 03 00` followed by zeros.

A stream that ends in the middle of a count throws, because the reference reads it with `ReadUInt16`.

## Notes

* The output is `width * height` bytes exactly: the slack is an implementation detail of the reference's buffer
  and never part of the image, which a test checks by measuring the bitmap.
* Rows are packed at the image width, so the bitmap's own four byte padding is the writer's; a two pixel wide
  test shows `01 02 00 00`.
* The entry is named after the source file with a `bmp` extension, covers the whole stored file and keeps
  `sizeKnown: false`; it is marked `compressed`. Metadata carries the dimensions and the eight bit depth, and the
  archive metadata names the `mal-rle` step. The reference declares no extensions and the port matches.
* A file shorter than the header and zero dimensions are declined, the latter as a documented deviation.
* `Write` throws `NotImplementedException` in the reference, so encoding is out of scope.

## A fixture note

The two pixel test first expected a two byte body and got four, because a bitmap pads rows to four bytes — the
same oversight as the BPIC port two commits earlier. Both ports now assert the padded body, and the padding is
worth checking deliberately rather than by accident.
