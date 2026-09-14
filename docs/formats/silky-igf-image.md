# Silky's image

Reference: `GARbro/ArcFormats/Silky/ImageIGF.cs`, class `IgfFormat`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/silky/igf-image.ts` (`silkyIgfImageDescriptor`, `silkyIgfImageFormat`,
id `silky-igf-image`).

An image behind the word `ZEUS` (`0x5355455A`) with a header of `0x14` bytes:

| field | offset |
|---|---|
| `ZEUS` | 0 |
| width, height | 4, 8 |
| the size the packed stream unpacks to | 0x0C |
| flags | 0x10 |

The depth is the **low byte of the flags**, and a zero there means **thirty two** bits; the high bit says the
pixels behind the header are packed. A depth that is neither twenty four, thirty two nor eight bits is handed to
a grey bitmap by the reference whatever its real size, which a buffer of that stride cannot fill, so the port
refuses it when the image is read — after describing it, as the reference does.

The pixels are read from `0x14` either outright, in which case the reference wants exactly
`height * width * depth / 8` bytes and fails on anything shorter, or through the library's `LzssReader` with its
frame filled with `0x20` rather than the library's zero — which is the only setting the reference changes, and
which the codec takes as its own frame fill. A packed stream that does not unpack to the size the header declares
leaves the bitmap a buffer it cannot take, so the port reports that instead.

`ImageData.CreateFlipped` is what produces the bitmap, so the stored rows are **bottom up** and the bitmap keeps
a positive height. Twenty four bits become a blue, green, red bitmap, thirty two a blue, green, red, alpha one,
and eight a grey one; anything else is the case described above.

Details worth recording:

* the reference's `LzssReader` is not part of this repository's copy of GARbro, so the shared decoder stands in
  for it, with the frame fill the reference asks for and otherwise the library's defaults;
* the format declares no extension, so the word is the only way in;
* a zero width or height is refused here, where the reference would build an empty bitmap.

The tests cover the word and the absent extension, the depth rules including a zero that means thirty two, a raw
body with its bottom up rows, a thirty two bit image, eight bit pixels written as grey, the frame fill of the
packed stream — one match reading a window nothing has written yet, which a zero filled window would answer with
zeroes — a packed stream of literals, a short raw body and a packed size that does not fit, a depth the bitmap
cannot take, and the entry name.
