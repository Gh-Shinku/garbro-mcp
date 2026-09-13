# System21 TEX texture

Reference: `GARbro/Legacy/System21/ImageTEX.cs`, class `TexFormat`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/system21/tex-image.ts` (`texImageDescriptor`, `texImageFormat`, id
`system21-tex-image`).

An **SZDD** packed DirectDraw surface:

| field | offset |
|---|---|
| signature `SZDD` | 0 |
| SZDD header, which the reference seeks past | 4 |
| LZSS stream | 0x0E |

`OpenLzStream` opens `LzssStream` with a frame of 0x1000 bytes, pre-filled with **0x20**, and a write position
of `0x1000 - 0x10`. Those are the same non-default settings the `BM_` port needs, and for the same reason: the
fill is observable, because a match can reach into a part of the ring buffer nothing has written. A test proves
it — the first 132 decompressed bytes are literals and the rest are matches into index 0x800, so the tail of the
extraction comes out as `0x20` bytes where the codec's default fill of zero would give zeros.

## Probing means decompressing

`ReadMetaData` reads a **hundred and thirty two** decompressed bytes, declines outright if it cannot get all of
them, and requires `DDS ` at offset four — so the surface starts four bytes into the stream, which is why both
the probe and the extraction drop that prefix. The port decompresses exactly the window for detection
(`inflateLzss` with `outputLength`, which tolerates a short stream and reports what it got) and to the end of the
stream for extraction (`inflateLzssAll`). DirectDraw header fields, relative to the start of the decompressed
stream: height at 16, width at 20, the pixel format's four character code at 84 and its bit count at 88.

This project has no DirectDraw decoder, so the surface is **passed through** as it stands — the Malie MGF and
Palette PGA pattern — with the four byte prefix removed. The entry is a `dds` file with `sizeKnown: false`,
since decompression changes length, and the tests compare it with the fixture byte for byte.

## Two formats, one codec, one signature

`misc-lz-bmp-image` (GARbro's `Bm_Format`) also claims `SZDD`, over the same LZSS variant, and expects a bitmap
behind it. Both formats therefore have to decide for themselves whether the payload is theirs, and both re-check
the signature in their own detection rather than trusting the registry's gate. The port grew that check only
after a test that flips the second byte of the tag and still expects a decline failed — the **third** time this
exact omission has been caught in this project (after `BM_` and PIC), which is now worth stating as a rule rather
than a lesson:

> A format's `detect` must verify everything `readLayout` depends on, including its own signature. The registry
> gate is a filter for the dispatcher, not a precondition for the format.

A sweep of every ported format for that rule — `scripts/audit-signature-checks.mjs`, which reports files that
register a signature but never mention any signature-like constant — turned up four candidates, and all four
turned out to re-check by other means: `emon/eme` compares the literal `RREDATA ` in its index reader,
`riddle/pac` compares `SIG`, `sceneplayer/pmx` compares a first byte through `ZLIB_FIRST_BYTE`, and
`reallive/g00` gates on a `g00` extension, which is stricter than the single byte signature it registers. So the
rule holds across the codebase; the three formats where it did not were all fixed when their tests caught them,
which is the argument for writing the flipping test in the first place.

## Notes

* Block compressed surfaces report a bit count of zero, so the depth comes from the four character code instead:
  `DXT1` and `ATI1` are four bits a pixel, `DXT2` to `DXT5`, `ATI2` and `BC5U` are eight.
* The fourteen byte SZDD header is never read. A test fills it with markers and checks that the extraction
  matches the surface exactly, and that only the first four bytes are the signature.
* A window that cannot be filled, a payload without the `DDS ` marker, zero dimensions, dimensions above 0x10000
  and a pixel count above 256 MiB are declined. The two size limits are recorded deviations; the reference would
  take whatever the header said.
* Metadata carries the dimensions, the optional depth and the four character code, and the archive metadata also
  names the `szdd` codec. The reference declares no extensions and the port matches.
* `Write` throws `NotImplementedException` in the reference, so encoding is out of scope.
