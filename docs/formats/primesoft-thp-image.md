# Prime Soft THP image

Reference: `GARbro/Legacy/PrimeSoft/ImageTHP.cs`, class `ThpFormat`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/primesoft/thp-image.ts` (`thpImageDescriptor`, `thpImageFormat`, id
`primesoft-thp-image`).

A palette indexed image: four header bytes, a 256 colour palette of three byte entries, then a one and two byte
run-length stream.

| field | offset |
|---|---|
| width (`u16`) | 0 |
| palette, 768 bytes | 4 |
| pixel stream | 772 |

## The reference reads the first word twice

```csharp
ushort width  = header.ToUInt16 (0);
ushort height = header.ToUInt16 (0);
```

Both calls pass offset zero, so **the height is whatever the width is** and the word at offset two is never
looked at. That is a bug, but it is not a cosmetic one: the decoder reads `height * width` pixels, so the port
reproduces it rather than fixing it — with the true height the port would decode the wrong number of pixels and
disagree with the reference about every file. A test writes nine into the second word for a width of three and
checks that the format reports a height of three and still decodes nine pixels.

## The stride is computed but never used

`Read` computes a padded stride, `(width + 3) & ~3`, and allocates `height * stride` bytes — then fills that
buffer **contiguously**, `pixels[dst++]` with no row break, and decodes only `height * width` pixels. For a width
that is not a multiple of four the rows therefore drift into the padding: with a width of three, the last byte of
row zero holds the first pixel of row one, and the tail of the buffer stays zero until a run reaches it.

Both halves are ported and tested. The bitmap is assembled from the header plus the palette plus the buffer
verbatim — the stored stride rule the PlanTech PAC port established — rather than repacked through the shared
eight bit writer, which would silently re-align the rows the reference leaves misaligned. Because the buffer is
exactly the bitmap stride times the height, a run may write the padding with pixel values as well: a test fills
all twelve bytes of a three by three image with a run, and another checks that a longer run throws, since the
reference's store is unchecked.

## Notes

* `Signature` is zero and no extension is declared, so the format gates on the `.THP` extension in its layout
  reader, exactly as the Ikura GGA port does.
* The palette is declared **`Bgr`**, so the stored triples are already in the order a bitmap wants and the bytes
  are carried through as they stand. This is the opposite of WBM and LGF, where `Rgb` and `RgbX` forced a
  red-blue swap; a test uses the triple `(5, 7, 11)` and expects `[5, 7, 11, 0]` here against `[11, 7, 5, 0]`
  there.
* `ImageData.CreateFlipped` is bottom up, which a bitmap records as a positive height.
* The pixel byte is read with `ReadUInt8` and the next byte is **peeked** — the reference's `PeekByte` reports
  the end of the stream as minus one, which never equals a pixel value, so a final byte is a literal. Running
  out of stream throws, as does a palette shorter than 768 bytes.
* Zero dimensions, dimensions above 0x4000 and a header shorter than four bytes are declined.
* `Write` throws `NotImplementedException` in the reference, so encoding is out of scope.

## A fixture note, the third in a row

Every failure this port had was in my own fixture arithmetic, not in the port: the first fixtures were sized for a
three row image when the reference's height bug makes it four, the count byte of one fixture was written at the
wrong offset, and the first expectation counted the run's pixel both as a literal and as the run — the run is the
only place a repeated pixel is written. The pattern is consistent enough to be worth stating: in this project the
reference reading logic has been right far more often than the numbers I build fixtures from, and the geometry of
these formats (padded strides, re-used header words, run semantics) is where the mistakes live.
