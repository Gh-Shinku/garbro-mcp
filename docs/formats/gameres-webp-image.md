# WebP image

Reference: `Experimental/WebP/ImageWEBP.cs` (tag `WEBP`, class `WebPFormat`) of GARbro, commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

The reference hands the stream to the platform library (`libwebp`), which this project does not carry, so this port
decodes the image itself.

This port reads:

* the container (RIFF, with the `WEBP` four character code at offset 8) and the `VP8X`, `ALPH`, `VP8 ` and `VP8L`
  chunk headers; `EXIF`, `XMP ` and `ICCP` chunks are ignored;
* lossless images (`VP8L`): the transforms, the meta-Huffman codes, the LZ77 stage with the distance plane map, the
  colour cache and colour indexing, including the alpha channel;
* lossy images (`VP8`) that are key frames, for any picture size and any number of token partitions: the frame and
  partition headers, the macroblock modes, the coefficients, the second-order (WHT) stage, all intra predictors, the
  inverse transforms, the reconstruction of every macroblock row, the in-loop filter, and the BGRA places of the file
  that the reference asks libwebp for (`WebPDecodeBGRAInto`).

* the alpha plane of a lossy picture that carries one (`ALPH`): the raw and the lossless storages, the three filters
  and the levels left as the stream stores them.

Refused, each with a message of its own: animation (`ANIM`/`ANMF`). A partially supported image is detected and
refused when it is extracted; the refusal is not a detection failure.

## Fixtures and oracle

The lossless fixtures were written by Pillow and read back through `libwebp`, so their expected pixels come from
another implementation.

The lossy fixtures are compared **byte for byte** with the planes written by `ffmpeg -f rawvideo -pix_fmt yuv420p`,
that is with an independent decoder, *including* its in-loop filter. Both available decoders agree on that output:
for all fourteen fixtures below, `libwebp` (read through `WebPDecodeYUV`, the library the reference delegates to)
writes exactly the same bytes as `ffmpeg`. `tests/helpers/webp.ts` holds the fixtures and their expected planes; the
single macroblock row cases are 16x16 (solid, chequerboard, gradient, noise, quality 90), 4x3 and 48x16, and the
multi row cases are 16x32, 16x48, 16x64, 32x48, 48x32 and 64x48. `NOISE_WEBP` and `NOISE_BIG_WEBP` are noise, which
the encoder codes as 4x4 blocks, so they also cover the 4x4 predictors in later columns and macroblock rows.
`MULTI_PARTITION_WEBP` is a 64x48 picture with four token partitions, written by `libvpx` through
`ffmpeg -c:v libvpx -slices 4 -auto-alt-ref 0 -lag-in-frames 0`.

### The BGRA places of the file

The reference does not ask libwebp for planes but for BGRA places of the file (`WebPDecodeBGRAInto`), so the port
converts the planes the same way: the chroma planes are upsampled with the fancy walk of the reference
(`UpsampleBgraLinePair` of `src/dsp/upsampling.c`, the `([9a+3b+3c+d, 3a+9b+3c+d; 3a+b+9c+3d, a+3b+3c+9d] + [8 8]) / 16`
interpolations on the packed chroma counts, with the first row of the picture mirroring the first chroma row and the
last row of an even sized picture mirroring the last chroma row) and every place of the file is converted with the
fixed point BT.601 rules of `src/dsp/yuv.h` (`MultHi`, `VP8Clip8`, `VP8YUVToR/G/B`). A picture without an alpha plane
gets an opaque alpha channel, which is what the reference library writes as well.
`packages/formats/src/shared/webp-vp8-bgra.ts` holds that walk.

The expected places of the file of these fixtures are the bytes `WebPDecodeBGRA` writes, read through the platform
library of the machine this was written on, so the expectation comes from the very library the reference delegates
to. `tests/helpers/webp.ts` records them for ten pictures, including `ODD_WEBP` (5x7) and `LOSSY_WEBP` (4x3), which
cover the odd width and the odd height tails of the upsampling.

### The alpha plane of a lossy picture

`packages/formats/src/shared/webp-alpha.ts` reads the `ALPH` chunk (`ALPHInit`, `ALPHDecode` and
`WebPUnfilters` of `src/dec/alpha_dec.c` and `src/dsp/filters.c`). Its one byte head names the storage of the plane
(raw bytes, or a lossless bit stream), the alpha filter (none, horizontal, vertical, gradient), the preprocessing of
the levels and two reserved bits that must be clear.

The lossless storage is a VP8L bit stream **without a five byte head of its own**: the dimensions come from the
picture, so the stream starts at its transforms, which is why `readVp8lStream` of `webp-lossless.ts` exists next to
`readVp8lPicture`. The alpha value of a place of the file is the **green** channel of the decoded pixel
(`WebPExtractGreen`: the values of an alpha only stream live in the green plane). The filter then runs over the plane,
row by row, with the row above as the prediction for the vertical and gradient kinds; the first row always stands for
the horizontal filter, because the reference falls back to it whenever there is no row above.

The preprocessing flag says that the levels of the plane were quantised when the picture was written. libwebp spreads
them out again only when the caller asks for alpha dithering, which the reference does not, so this walk leaves the
levels as they stand, exactly like the reference library does.

The expected alpha bytes of the fixtures are the alpha bytes of the BGRA places of the file the platform library
writes for the whole picture, so they come from the reference library. `tests/helpers/webp.ts` records seven
pictures: a raw plane in its own chunk (the `PLACES_WEBP` fixture), a lossless plane, a plane written with the
horizontal filter, a plane whose levels were quantised, an odd sized picture (5x7) and two pictures whose planes carry
the vertical and the gradient filters. The library of the picture of the web never chooses those last two filters by
itself, so this port builds them from the plane of the lossless fixture with the forward filters of the same reference
file; the library reads them back to exactly the places of the file of the picture they were built from.

### Token partitions

A picture with a single token partition keeps all of its coefficient data in one partition and stores no sizes. A
picture with more than one stores the sizes of the first `count - 1` of them as three byte values in little endian
order (`ParsePartitions` of libwebp reads them little endian, whatever RFC 6386 says), the partitions follow that
table and the last one runs to the end of the token data. A macroblock row takes the partition
`mb_y & (count - 1)`, so a row is independent of the rows before it in the bit reader, but every row that shares a
partition continues its bit stream.

## The lossy stage (VP8)

The lossy decoder follows libwebp's decoder (`src/dec/vp8_dec.c`: `VP8GetHeaders`, `ParseSegmentHeader`,
`ParseFilterHeader`, `ParsePartitions`; `src/dec/quant_dec.c`: `VP8ParseQuant`; `src/dec/tree_dec.c`:
`VP8ParseProba`, `ParseIntraMode`; `ParseResiduals`, `GetCoeffsFast`, `GetLargeValue`; `src/dsp/dec.c`: the inverse
transforms and the in-loop filter; `src/dec/frame_dec.c`: `ReconstructRow`, `FinishRow`, `DoFilter`,
`PrecomputeFilterStrengths`), and the bit reader is a port of `src/utils/bit_reader_inl_utils.h` /
`src/utils/bit_reader_utils.c` rather than an equivalent RFC 6386 formulation, because an equivalent formulation
silently diverges from libwebp on real streams.

The three generated constant tables (`DEFAULT_COEFFICIENT_PROBABILITIES`, `COEFFICIENT_UPDATE_PROBABILITIES`,
`FOUR_PLACE_MODE_PROBABILITIES`), the coefficient bands and the two quantiser lookup tables in
`packages/formats/src/shared/webp-vp8-tables.ts` were produced from that library by a script of this project and were
checked value by value against the C sources (BSD 3-Clause, credited in the file header).

Evidence used while porting: libwebp's own encoder defaults (`src/enc/config_enc.c`) match the parsed values of a
Pillow 64x48 `method=4/quality=75` fixture five for five; the quantisers of a q10 image are never larger than those
of a q90 image; an all-zero partition reproduces the default probability table exactly; and the pixel output of the
decoder is compared byte for byte with two other decoders, as described above.

### The in-loop filter

`packages/formats/src/shared/webp-vp8-filter.ts` holds the filter. The strengths are precomputed per segment and per
macroblock kind (`PrecomputeFilterStrengths`: the frame level, the per-segment level with its absolute or relative
delta, the reference and mode deltas, the clamp to 0..63, the sharpness cap on the inner level and the two high edge
variance bands at levels 15 and 40). A level that comes out zero anywhere turns the filter off for that macroblock.

`DoFilter` is walked for every macroblock of a row, left to right: the vertical edge shared with the macroblock
before it, the three inner vertical edges, the horizontal edge shared with the row above, and the three inner
horizontal edges. The first macroblock of a row and the first macroblock row are the frame border, so they are left
alone, as are the right and bottom frame borders. Whether the inner edges are filtered at all is `f_inner`, which
libwebp sets to the 4x4 flag of the macroblock when its coefficients are skipped and to one otherwise, so a
macroblock that carries coefficients always has them filtered. Both filter kinds are ported: the two tap simple
filter and the four and six tap normal filter, luma and chroma.

The filter must not feed the predictors. libwebp reconstructs a macroblock row into a scratch buffer and stashes its
bottom row (`top_yuv`) *before* the filter runs, then filters a separate row cache that is what it hands out, so
intra prediction reads unfiltered neighbours. This port keeps two sets of planes for the same reason: the planes the
predictors read stay unfiltered and the filtered picture is built in a second set of planes that the result is
cropped from. Filtering the prediction planes in place decodes single macroblock row pictures correctly and diverges
from the third row on.

### The four samples above and to the right of a macroblock

For 4x4 blocks the predictor needs four samples to the right of the block's top row. libwebp fills them from the
macroblock's stash of the row above (`ReconstructRow`, `top_right`): the four samples that follow the macroblock in
that row, or the last sample of that row repeated for the rightmost macroblock; for the first macroblock row the
stash still holds the frame border value (127) and the write is skipped. The same four values are then copied down
into the following three 4x4 block rows, so every block row sees the samples of the row **above the macroblock**, not
the samples above its own row. Reading them from the per-row plane instead (which is what this port did at first) is
wrong for every 4x4 macroblock that is not in the first macroblock row and not in the last column, because the
samples of the next macroblock in the current row have not been reconstructed yet.

### Scan line state

Every macroblock row starts with the left neighbours reset (`VP8InitScanline`): the non-zero context and the left
intra modes are the frame border values, not the values left behind by the last macroblock of the row above. Missing
this reset decodes the first macroblock row correctly and diverges in the third row and later, because the left
context of a row only differs once the row above has stored a non-zero value there.
