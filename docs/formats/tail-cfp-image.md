# Tail image formats

Reference: `GARbro/ArcFormats/Tail/ImageCFP.cs`, classes `CfpFormat`, `CfpMetaData` and `Cfp2Format`. GARbro
commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/tail/cfp-image.ts` — `tailCfpImageDescriptor` / `tailCfpImageFormat`
(id `tail-cfp-image`) and `tailCfp2ImageDescriptor` / `tailCfp2ImageFormat` (id `tail-cfp-reb2-image`), with
`readCfpLayout`, `readCfp2Layout`, `unpackCfp` and `unpackCfp2`.

## CFP — twenty four bits a pixel in six planes of nibbles

The word at nought is `REB ` or, standing in its low half, `BR` — so the four bytes of that second mark have
to read as `BR` and two noughts. The width and the height stand at `0x14` and `0x18` as words and the depth is
always reported as twenty four bits.

The planes are the **last** `width rounded up to two pixels × height × 3` bytes of the file, so a row of the
planes may hold one more pixel than the picture. Six planes of half that many bytes each hold the nibbles of
the blue, the green and the red bytes two pixels at a time: one byte from each plane makes both pixels, the
low nibble of the second plane and the high nibble of the first making the first pixel, and the high nibbles
of both making the second.

The planes are walked from the **bottom** row up, so the first row of a plane is the lowest row of the
picture; the result is handed out top down, which is what `ImageData.Create` means.

## CFP/REB2 — a transparent bitmap

The head begins with `REB2`, the start stands at `0x10` as a word and may not be smaller than `0x36`, the
width and the height stand at `0x14` and `0x18`, and the depth is always reported as thirty two bits. Where
the picture itself would reach past the file its planes stand right behind the start at `0x1C`; otherwise the
word at `0x1C` says how far behind the head they stand. Four planes of the whole picture hold the blue, the
green, the red and the fourth byte of every pixel in turn, walked from the **bottom** row up as above.

The write paths of both formats throw `NotImplementedException`, so this is a read only pair.

Deviations from the reference, all in the message only: a picture with nothing for a width or a height, a
measurement past `0x8000`, a start smaller than `0x36`, and a file too short to hold the planes are refused.
One more deviation is worth naming: a width that is odd and one above a multiple of four makes the planes
wider than a row of the reader's own buffer, which the reference's own array write would answer with an
exception; the port walks the planes with the wider step and then takes the padding of every row out.

The tests cover both heads and the fields they are turned away for, the two ways a word marks the planes of
the older variant standing at the end of the file, the walking of the planes bottom row up, an odd width
rounded up to two pixels, both ways the head of the newer variant says where its planes stand, and the two
files that are not signed.
