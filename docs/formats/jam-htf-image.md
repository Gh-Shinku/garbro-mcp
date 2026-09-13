# Jam HTF image

Reference: `GARbro/Legacy/Jam/ImageHTF.cs`, class `HtfFormat`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/jam-creation/htf-image.ts` (`htfImageDescriptor`, `htfImageFormat`,
id `jam-htf-image`).

A **Huffman compressed bitmap**. A four byte unpacked size is followed by the stream that decodes to a
bitmap:

| field | offset |
|---|---|
| unpacked size (`i32`) | 0 |
| Huffman stream | 4 |

The codec is the repository's existing `decompressHuffman`, which mirrors GARbro's
`HuffmanDecompressor.Unpack`. The contract was checked against the reference before this port rather than
assumed: the tree and the data share one bit stream in the same bit order, and GARbro's
`HuffmanStream(Stream, bool leave_open)` takes **no frame size parameter**, so unlike the LZSS ports there
is no framing to match. The only parameter that matters is the output length, which the container declares.

The port exposes the resource as a single entry:

* detection requires the `.HTF` extension — the reference returns before reading anything if the name does
  not match — and an unpacked size in `1..0x1000000`. It then has to decompress, because the reference's
  `ReadMetaData` decodes the stream to read the bitmap header; the container's own size field is what caps
  that allocation, so no separate limit is needed. A stream that decodes to something that is not a bitmap,
  a bitmap with an OS/2 header, and a truncated stream are all declined, each tested;
* extraction decompresses to the declared unpacked size and then trims the result to the length the
  **bitmap's own header** declares. That distinction is the reason the fixture for this case is built
  carefully: the bitmap's `bfSize` covers only the bitmap, while the container's size covers everything the
  stream holds, and the port follows both rather than conflating them. The first version of that test used a
  sentinel byte to prove the tail was dropped, which proves nothing here — the grey palette legitimately
  contains every byte value — so it compares the output against the bitmap's declared prefix instead;
* the entry is named after the source file with a `bmp` extension, covers the stored stream from offset 4,
  and is flagged `compressed: true` with `sizeKnown: false`;
* entry metadata carries `type: "image"`, width, height and bit depth, and the archive metadata records
  `image: "bmp"` and `compression: "huffman"` along with the same fields.

The reference declares no signature, so the descriptor registers none; the format is a candidate for every
file and the extension plus the header check carry detection. The descriptor advertises `htf`.

GARbro's `Write` throws `NotImplementedException`, so encoding and archive creation are out of scope.
