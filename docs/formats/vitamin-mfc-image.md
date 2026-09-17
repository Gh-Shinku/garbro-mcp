# Vitamin image with alpha channel

Reference: `GARbro/ArcFormats/Vitamin/ImageMFC.cs`, classes `MfcFormat`, `MfcMetaData` and its `RleUnpack`
walk. GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/vitamin/mfc-image.ts` (`vitaminMfcImageDescriptor`,
`vitaminMfcImageFormat`, id `vitamin-mfc-image`, `readMfcLayout`, `unpackMfcAlpha`).

The file begins with the word `MFC` and a line feed. The four bytes at four must be a one, nothing, a one and
a four; the size of the alpha channel stands at twelve as a word; and the base picture — a Vitamin picture of
its own, read with the same reader the [`SBI` format](vitamin-sbi-image.md) uses — begins where the alpha
channel ends. The measurements and the depth are the base picture's, and the picture is always handed out
thirty two bits a pixel.

The alpha channel is a run length code of its own, bounded by the size the head declares:

* a byte below `0x80` is that many alpha bytes that stand in the stream themselves;
* a byte at `0x80` or above is that many less `0x80` copies of the byte behind it.

The channel holds **four bits a pixel**, packed two to a byte, and the reference reads them from the **low
nibble first** and widens each by repeating its four bits. A picture whose pixel count is odd leaves half an
alpha byte for its last pixel; the reference would read past the channel for it, so this port refuses such a
picture rather than invent a value.

The colour of the base picture is what the reference's own framework conversion to `Bgra32` produces: a
twenty four bit picture keeps its three bytes, a sixteen bit one has its five or six bit channels widened by
repeating their high bits, an eight bit one goes through its colour map when it has one and is a ramp of greys
when it has not, and a thirty two bit one keeps its three bytes. The alpha channel is then written into the
fourth byte of every pixel, which is why a thirty two bit base whose fourth byte is anything at all still
comes out right. The write path of the reference throws `NotImplementedException`, so this is a read only
format.

The tests cover the head and the base picture it points at, the four marker bytes and a base picture that is
not a Vitamin picture, the measurements the port reports, a thirty two bit base written out with the alpha of
the channel, a twenty four bit base widened, the run length walk of the alpha channel and its bound, and a
picture that does not hold a whole number of alpha pixels.
