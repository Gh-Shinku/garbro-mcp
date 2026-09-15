# Ivory image format

Reference: `GARbro/ArcFormats/Ivory/ImageMOE.cs`, class `MoeFormat`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/ivory/moe-image.ts` (`ivoryMoeImageDescriptor`, `ivoryMoeImageFormat`, id
`ivory-moe-image`, `readMoeLayout`, `isValidMoeInput`, `decodeMoe`, `greyRampPalette`).

The reference declares no signature for this format: the first four bytes of the file are the measurements of
the picture, the width in the lower half of the word and the height in the upper half. The extensions it
declares are `moe` and `shw`. The picture may measure up to eight hundred by six hundred and not less than one
either way; a file whose stream does not hold a whole picture is turned away as well, by a walk over the stream
that reads nothing of it.

That walk is also how the picture is read. A control byte of `0x80` and above stands for a run of that many
pixels less one hundred and twenty eight that stand in the stream themselves, and any other control byte for a
run of that many pixels of which the first stands in the stream and the rest repeat it, so a run of two repeats
the pixel behind it once and a run of one is that pixel alone. The walk over the stream counts the pixels of
each run and turns a picture away when it lands past the last of them; a stream that ends where a control byte
is wanted is turned away there too. In the reading, a run of pixels that stand in the stream reads as many as
the picture still holds room for and leaves the rest as they stand; a run that writes past the picture is
refused, as is a run of no pixels, which is where the reference's own copy would refuse it as well.

The depth of the picture comes from the name of the file rather than from the file itself: a file named `.shw`,
in either spelling of the letters, holds a grey picture of one byte to the pixel and every other one a picture
of three, written out top down. The grey picture carries a ramp of seventeen shades, black at the front and
white at the back, with nothing behind them; the picture of three channels is written out as it stands. The
write path of the reference throws `NotImplementedException`, so this is a read only format.

The tests cover the measurements at the front of the file, the declines of a picture of no width or height, of
one wider than eight hundred or taller than six hundred and of one too short to hold the measurements, the
depth taken from the upper case and the lower case spelling of the name, the walk that counts the pixels of a
picture and turns away one the stream does not hold, the pixels of a picture of three channels written out with
a run that repeats the pixel behind it, the ramp of the grey picture, the refusal of a stream that runs out
inside the picture, of a run of no pixels and of one that writes past the picture, and the reading of a picture
of one pixel.
