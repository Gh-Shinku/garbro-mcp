# JPEG image file format

Reference: `GARbro/GameRes/ImageJPEG.cs`, class `JpegFormat`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/gameres/jpeg-image.ts` (`gameresJpegImageDescriptor`,
`gameresJpegImageFormat`, id `gameres-jpeg-image`, `readJpegLayout`).

The reference registers **two words**: the start of an image marker followed by the segment a camera writes
first, and the word of nothing, which offers the format for every file that no other format claimed. Its
extensions are `jpg` and `jpeg`, and it exports itself with the **priority of ten**, which puts it before the
formats that carry no priority of their own — the port asks for the same priority, and for the same two words.

The measurements and the depth are read by walking the segments of the file, which the shared reader of this
project does the same way as the reference: the segment of a frame kind — any marker from `0xC0` to `0xCF`
apart from `0xC4`, the marker of the Huffman tables — carries the bits of one sample, the measurements and the
number of colours to a pixel, and the depth is their product. A segment's own length walks the reader over its
body, and a walk that runs into the end of the file, or into a marker that is not a segment at all, stops
without a picture.

The picture is decoded, as the reference decodes it: the reference hands the stream to the platform decoder
of the Windows imaging stack (`JpegBitmapDecoder`), and this port hands it to its own reader of the format
(`packages/formats/src/shared/jpeg-image.ts`), which follows the baseline sequential profile of ITU-T T.81.
The entry is named `image.bmp` and holds a bitmap of the places that reader returns.

The platform decoder widens a twice-as-coarse chroma inside its colour conversion, while the reader of this
project widens it in the colour space of the stream, so the two pictures differ by a few places at the edge
of a colour change; a stream of one grey component, or one whose components each sample the picture, agrees
to within the rounding of the colour conversion. A progressive stream, a stream of four places a colour, of
twelve bits a sample or of arithmetic coding is turned away as an unsupported feature. Writing the format is
not ported, though the reference can write one through the encoder of its framework.

The tests cover finding a picture behind the word of the format, finding one through the word of nothing when
the segment a camera writes first is absent, stepping over a segment that is not a frame, declining a file
that does not walk as a picture, the depth as the product of the bits and the colours — beside a grey picture
of eight bits — the picture decoded into a bitmap (a grey stream exactly as the Python imaging library decodes it, and a
stream of three components within two places of the same), and a file that is not a picture.
