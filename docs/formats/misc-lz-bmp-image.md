# LZ-compressed bitmap (`BM_`, `SZDD`)

Reference: `GARbro/ArcFormats/ImageLZ.cs`, class `Bm_Format`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/misc/lz-bmp-image.ts` (`lzBmpImageDescriptor`, `lzBmpImageFormat`, id
`misc-lz-bmp-image`).

A bitmap compressed by Microsoft's `COMPRESS.EXE`, recognised by its `SZDD` marker. The reference registers
four extensions for the same layout — `bm_`, `gpp`, `meh` and `gr_` — which is why the port lives in the
generic `misc` directory rather than under an engine.

| field | offset |
|---|---|
| signature `SZDD` | 0 |
| header fields — **none of them read** | 4..0xD |
| LZSS stream | 0xE |

The whole fourteen byte header is skipped: the mode byte, the missing-character byte and the declared unpacked
size are never consulted. A test overwrites all ten of those bytes with `0xA5` and asserts that the extraction
is identical to the untouched file, so the header really is inert.

**This is the first port that needs non-default LZSS settings.** The reference overrides three of them:

* `FrameSize` is the usual `0x1000`;
* `FrameFill` is **`0x20`**, not the default zero, so the ring buffer is pre-filled with spaces;
* `FrameInitPos` is **`0xFF0`**, not the default `0xFEE`, because the reference starts the write position
  sixteen bytes before the end rather than eighteen.

The shared `inflateLzssAll` takes all three as settings, and the port reports them in the archive metadata. The
test proves they are actually in force by pointing a match token at ring buffer index `0x800`, which no literal
ever reaches — the pixel bytes come back as `0x20` spaces, where a default fill would have produced zeros. The
first version of that test used index zero and got the wrong answer for an instructive reason: with the write
position at `0xFF0` the first sixteen literals wrap around and overwrite the low addresses, so a match at zero
copies header bytes rather than fill. A comment in the test records this so the trick is not rediscovered.

The port exposes the resource as a single entry:

* the decompressed payload is validated with the shared `readBmpMetaData` and trimmed to the bitmap's own
  `bfSize`, and the port re-checks the `SZDD` signature inside its own detection rather than relying only on the
  registry's signature gate — the first version of the port checked only the file length and accepted a file
  whose marker had been altered, which a test caught;
* the entry is named after the source file with a `bmp` extension, covers the whole stored file, and is flagged
  `compressed: true` with `sizeKnown: false`;
* entry metadata carries `type: "image"`, the dimensions and the depth; the archive metadata records
  `image: "bmp"`, the compression name `szdd-lzss`, the dimensions and the three frame settings;
* deviations, tested: a payload that is not a bitmap, a file shorter than the stream offset, a missing or altered
  signature and a zero sized image are all declined. The reference would build an empty image for the last case.

GARbro's `CanWrite` is false, so encoding is out of scope.
