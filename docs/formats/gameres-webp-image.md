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
* lossy images (`VP8`) that are key frames whose token data is not split into several partitions, for any picture
  size: the frame and partition headers, the macroblock modes, the coefficients, the second-order (WHT) stage, all
  intra predictors, the inverse transforms and the unfiltered reconstruction.

Refused, each with a message of its own: animation (`ANIM`/`ANMF`); an alpha channel carried in a separate `ALPH`
chunk; lossy images whose token data is split into more than one partition. A partially supported image is detected
and refused when it is extracted; the refusal is not a detection failure.

## Fixtures and oracle

The lossless fixtures were written by Pillow and read back through `libwebp`, so their expected pixels come from
another implementation. The lossy fixtures are compared **byte for byte** with the planes written by
`ffmpeg -skip_loop_filter all -f rawvideo -pix_fmt yuv420p`, that is with an independent decoder asked to skip the
in-loop filter. `tests/helpers/webp.ts` holds the fixtures and their expected planes; the single macroblock row cases
are 16x16 (solid, chequerboard, gradient, noise), 4x3 and 48x16, and the multi row cases are 16x32, 16x48, 16x64,
32x48, 48x32 and 64x48. `NOISE_WEBP` and `NOISE_BIG_WEBP` are noise, which the encoder codes as 4x4 blocks, so they
also cover the 4x4 predictors in later columns and macroblock rows.

## The lossy stage (VP8)

The lossy decoder follows libwebp's decoder (`src/dec/vp8_dec.c`: `VP8GetHeaders`, `ParseSegmentHeader`,
`ParseFilterHeader`, `ParsePartitions`; `src/dec/quant_dec.c`: `VP8ParseQuant`; `src/dec/tree_dec.c`:
`VP8ParseProba`, `ParseIntraMode`; `ParseResiduals`, `GetCoeffsFast`, `GetLargeValue`; `src/dsp/dec.c`: the inverse
transforms; `src/dec/frame_dec.c`: `ReconstructRow`), and the bit reader is a port of
`src/utils/bit_reader_inl_utils.h` / `src/utils/bit_reader_utils.c` rather than an equivalent RFC 6386 formulation,
because an equivalent formulation silently diverges from libwebp on real streams.

The three generated constant tables (`DEFAULT_COEFFICIENT_PROBABILITIES`, `COEFFICIENT_UPDATE_PROBABILITIES`,
`FOUR_PLACE_MODE_PROBABILITIES`), the coefficient bands and the two quantiser lookup tables in
`packages/formats/src/shared/webp-vp8-tables.ts` were produced from that library by a script of this project and were
checked value by value against the C sources (BSD 3-Clause, credited in the file header).

Evidence used while porting: libwebp's own encoder defaults (`src/enc/config_enc.c`) match the parsed values of a
Pillow 64x48 `method=4/quality=75` fixture five for five; the quantisers of a q10 image are never larger than those
of a q90 image; an all-zero partition reproduces the default probability table exactly; and the pixel output of the
decoder is compared byte for byte with ffmpeg, as described above.

### The in-loop filter

The in-loop filter is not implemented. The port reconstructs pictures without it, which is exactly what
`ffmpeg -skip_loop_filter all` writes, so the comparison above is meaningful, but a picture decoded by a normal
decoder (including libwebp, which the reference uses) passes through the filter and will differ near block edges.
This is the main remaining gap of the lossy stage.

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
