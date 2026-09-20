# Black Rainbow bitmap format

Reference: `GARbro/ArcFormats/BlackRainbow/ImageBMD.cs`, classes `BmdFormat` and `BmdMetaData`, with the walk of
`GameRes.Compression.LzssReader`. GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/black-rainbow/bmd-image.ts` (`blackRainbowBmdImageDescriptor`,
`blackRainbowBmdImageFormat`, id `black-rainbow-bmd-image`, `readBmdLayout`, `unpackBmd`).

The file begins with the word `_BMD` — the word the reference registers — the size of the walk of runs stands
at four, the width and the height at eight and `0x0C` as words of four bytes, and a word at `0x10` stands
above nought where the fourth byte of a pixel is a fourth byte of a colour. The pixels are of four bytes a
pixel whatever that word says; the reference hands out a picture of `Bgra32` or of `Bgr32` and this project
writes both of them as a bitmap of thirty two bits, so the difference is only what the fourth byte means.

The pixels stand behind the head as the walk of `LzssReader` gives them, and that is the walk the shared codec
of this project already carries: a window of four thousand and ninety six bytes standing at `0xFEE`, every
control byte holding eight steps, its **lowest place first** — a step whose place stands is a byte of the
picture, and a step whose place does not is a pair of bytes: the two lower places of how far behind the byte
being written the run begins stand in the first of them and the four places above them in the second, with the
length of the run above those, three bytes short. A copy reads a byte at a time, so a run may read the bytes
it has just written.

What the walk does not give stands as nought, which is what the reference's own reader leaves behind: it stops
where the bytes it was told about run out and the picture behind them is left as it was allocated.

The picture is handed out **top down**, which is what `ImageData.Create` means. The reference can also write
this kind of picture; the port reads it only, since archive and picture creation is out of this project's
scope.

Deviations from the reference, in the message only: a picture with nothing for a width or a height and a walk
that does not stand inside the file are refused, where the reference would ask its own file view for bytes
past the end.

The tests cover the head, the word, the sizes and the walk it is turned away for, a walk of bytes that stand
as they are, a walk of a run that points back into the window, a picture whose fourth byte is a colour, a walk
that gives less than the picture asks for, and a file that does not hold a bitmap.
