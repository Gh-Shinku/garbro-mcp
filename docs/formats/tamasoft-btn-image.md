# TamaSoft BTN button image

Reference: `GARbro/ArcFormats/TamaSoft/ImageBTN.cs`, class `BtnFormat extends SurFormat`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/tamasoft/btn-image.ts` (`btnImageDescriptor`, `btnImageFormat`, id
`tamasoft-btn-image`). The codec is shared with the SUR reader: `packages/formats/src/tamasoft/sur-lzss.ts`.

A button bank whose last member is a whole SUR file:

| field | offset |
|---|---|
| signature `EBTN` | 0 |
| table count (`i32`) | 4 |
| unused | 8 |
| button table, four bytes an entry, never read | 0x30 |
| embedded SUR file | `0x30 + count * 4` |

`ReadMetaData` seeks to offset four, reads a signed count, computes `0x30 + count * 4` and re-parses the header
from there as if the region were a SUR file, keeping the offset in the metadata. `Read` reopens the same region
and hands it to the SUR decoder, which means **the pixel offset 0x20 is relative to the embedded file, not to
this one**. The reference builds the region as "from that offset to the end of the stream", so trailing bytes
after the embedded image are simply never reached, and a count that seeks before the start or past the end
fails.

Because the two readers share a codec and the layout reader, the SUR header parser was generalised to take the
offset a header sits at (`readSurLayout(source, baseOffset)`) in this change; the SUR port itself is unchanged
apart from calling it with zero. That is a smaller step than the SUR reader's own LZSS variants would have
needed, and it keeps a single copy of the sixteen byte header rule — including the requirement that the
signature is `ESUR`, which the port checks even though `SurFormat.ReadMetaData` does not.

## Notes

* The test that pins the rebasing uses a count of eight, which puts the embedded file at 0x50; the bytes at the
  absolute offset 0x20 are then the fixture's filler and not the compressed stream, so a port that forgot to
  rebase would decode the filler and fail.
* Nothing before the embedded file is read. Two tests fill the header tail and the table with a marker and check
  both the decoded pixels and the reported `surOffset`.
* A negative count seeks before the table and a count of `0x100000` past the end of the file; both are declined,
  as is an embedded region that does not start with a SUR header, which is the case where `base.ReadMetaData`
  would have to fail for the reference too.
* A stream that runs out inside the embedded file still lists, and extraction fails — the same split the SUR
  port documents, for the same reason.
* The entry is named after the source file with a `bmp` extension, covers the whole stored file and keeps
  `sizeKnown: false`; it is marked `compressed`. Metadata carries the dimensions, the depth and the offset the
  embedded file was found at. The reference declares no extensions and the port matches.
* `Write` throws `NotImplementedException` in the reference, so encoding is out of scope.

## A note on order

The SUR reader had to land first: it contributes the codec and the header rule this format is built on. The pair
is a good illustration of how the dependency between two reference classes maps onto two commits in this
project — the base class and its codec, then the derived format that supplies an offset instead of a file start.
