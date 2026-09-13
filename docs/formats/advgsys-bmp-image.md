# ADVGSys compressed bitmap

Reference: `GARbro/Legacy/ADVGSys/ImageBMP.cs`, class `AdvgFormat`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/advgsys/bmp-image.ts` (`advgImageDescriptor`, `advgImageFormat`, id
`advgsys-bmp-image`).

An **LZSS compressed bitmap**. The reference declares no signature and recognises a file by reading ten
bytes and testing two things: the low nibble of byte 4 is set, and bytes 5 and 6 read `BM`. It then seeks to
offset 4 and decompresses the rest of the file as an LZSS stream, whose output is a bitmap.

That marker deserves a note, because it looks arbitrary and is not. The stream begins at offset 4, so byte 4
is the stream's own first **control byte**, and bytes 5 and 6 are the first two literals that control byte
introduces. For a full group of eight literals the control byte is `0xFF`, whose low nibble is set, and the
literals are the bitmap's `BM` tag. The marker is therefore a consequence of how the compression starts
rather than a field the format stores — the file's first bytes look like `?? ?? ?? ?? FF 42 4D ...`. The
reference's test is loose: any control byte with the low nibble set passes, including ones that announce
matches later in the group, and the port keeps that looseness rather than tightening it.

The port exposes the resource as a single entry:

* detection has to decompress, since the reference's `ReadMetaData` reads the bitmap header from the
  decoded stream. This container declares no unpacked size anywhere, so unlike `Jam/ImageHTF.cs` the output
  cap is load-bearing: the port bounds the decoder at 64 MiB. A stream that decodes to something other than
  a bitmap, a bitmap with an OS/2 header, a file with a clear marker nibble, a file whose bytes 5 and 6 are
  not `BM`, and a truncated file are all declined, each tested;
* extraction decompresses and then trims the result to the length the bitmap's own header declares, since
  the stream may hold more than the image needs. A test builds a bitmap whose `bfSize` excludes an appended
  tail and asserts the output equals the declared prefix;
* the entry is named after the source file with a `bmp` extension, covers the stored stream from offset 4,
  and is flagged `compressed: true` with `sizeKnown: false`;
* entry metadata carries `type: "image"`, width, height and bit depth, and the archive metadata records
  `image: "bmp"` and `compression: "lzss"` along with the same fields.

The reference declares no signature and no extension list, so the descriptor registers none and the
extension gate is absent — the marker plus the decoded header carry detection alone.

GARbro's `Write` throws `NotImplementedException`, so encoding and archive creation are out of scope.
