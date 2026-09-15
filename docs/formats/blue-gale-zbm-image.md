# BlueGale compressed image format

Reference: `GARbro/ArcFormats/BlueGale/ImageZBM.cs`, classes `ZbmFormat` and `ZbmMetaData`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/blue-gale/zbm-image.ts` (`blueGaleZbmImageDescriptor`,
`blueGaleZbmImageFormat`, id `blue-gale-zbm-image`, `readZbmImageLayout`). The codec and the obfuscation are
shared with the animation archives of the same engine and are ported in
`packages/formats/src/blue-gale/zbm.ts` (`unpackZbm`, `decryptZbm`), which the animation port uses as well.

The signature word the reference declares is `0x5F706D61`, the letters `amp_`, and it declares no extensions.
The header is fourteen bytes:

| offset | what it holds |
| --- | --- |
| `0x00` | the letters `amp_` |
| `0x04` | a version word, which has to stand at one |
| `0x06` | how much the picture unfolds to, which has to stand above the length of a bitmap |
| `0x0A` | the place the picture stands at, which may not stand inside the header |

Behind the header stands the picture, packed with the token stream of the engine and laid over with the
obfuscation when its first two bytes come out as the letters `BM` turned about, which is what the reference
takes off both times it reads the picture. The measurements come from the first thirty two bytes of the bitmap
that unfolds at that place, read where a bitmap keeps them — the width at `0x12`, the height at `0x16` and the
depth at `0x1C`. The reference reads the height as a long word without a sign, so a bitmap whose rows stand the
other way up — the height of which is a value taken below nothing — comes out at the largest long word rather
than at the number of rows it holds. A picture whose measurements come out at nothing is turned away, as is one
whose stream does not unfold to something beginning with `BM`.

The picture is handed out by unfolding the whole bitmap, taking the obfuscation off it and then taking the
bitmap apart and writing it out again, which is what `Bmp.Read` does; the rest of the picture stands at nothing
where the stream does not fill it. The reference's write path throws `NotImplementedException`, so this is a
read only format, and a picture that unfolds to more than 256 megabytes is refused.

The tests cover the four letters of the signature and the version behind them, the declines of a version other
than one, of a stream that does not unfold to a bitmap, of a size that stands below the length of a bitmap, of a
place inside the header or past the file, and of a header that is not all there, the measurements of the bitmap
behind the stream — including the reading of a height taken below nothing — the picture written out of the
bitmap, the obfuscation taken off a picture that carries it, the rest of a picture the stream does not fill left
standing at nothing, a picture too large to hold, and the refusal to read a stream that does not unfold to a
bitmap.
