# KID image format

Reference: `GARbro/ArcFormats/Kid/ImagePRT.cs`, classes `PrtFormat`, `PrtMetaData` and `PrtReader`. GARbro
commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/kid/prt-image.ts` (`kidPrtImageDescriptor`, `kidPrtImageFormat`, id
`kid-prt-image`, `readPrtLayout`, `readPrtPalette`, `applyPrtAlpha`).

The file begins with the word `PRT` and a nought behind it. The version stands at four as a word — of which
only `101` and `102` are read, the second carrying a pair of offsets behind the head — the depth at six, the
fourteen, and a word at sixteen that says whether a plane of fourth bytes stands behind the pixels. Only
eight, twenty four and thirty two bits a pixel are read, and the row of the reader's own buffer is the width
in bytes rounded up to four whether the depth needs the padding or not.

An eight bit picture takes its colour map from the place the head gives, of two hundred and fifty six four
byte entries, and is written out as an indexed bitmap; the other two depths are written as they stand. Where
there is no plane of fourth bytes the picture is handed out **bottom up**, which is what
`ImageData.CreateFlipped` means, and the padding of the reader's own rows is taken out before the bitmap is
written.

Where there **is** such a plane it holds exactly a byte a pixel, right behind the pixels. The reader then
walks the **bottom** row of the pixels first, so the picture is turned the right way up as the fourth byte of
every pixel is taken from the plane in its own order; every pixel becomes four bytes — the colour's three
and the alpha behind them — and the result is handed out top down, which is what `ImageData.Create` means.

Deviations from the reference, in the message only: a depth other than eight, twenty four or thirty two
bits, a colour map or a plane of fourth bytes that reaches past the file, and a picture whose pixels do not
fit are refused rather than left to the reference's own exceptions. The write path of the reference throws
`NotImplementedException`, so this is a read only format.

bytes with the rows turned, the twenty four and thirty two bit pictures written out, the eight bit one with
its colour map, and a file that does not hold a picture.
