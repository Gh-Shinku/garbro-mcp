# U-Me Soft multi-frame image format

Reference: `GARbro/ArcFormats/UMeSoft/ImageGRX.cs`, classes `SgxFormat` and `SgxMetaData`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/umesoft/sgx-image.ts` (`umesoftSgxImageDescriptor`,
`umesoftSgxImageFormat`, id `umesoft-sgx-image`, `readSgxLayout`). The picture behind the header is the one
ported in [the U-Me Soft picture format](umesoft-grx-image.md), whose reader this module uses.

The signature word the reference declares is `0x1A584753`, the four bytes `SGX\x1A`, and the extensions it
declares are `grx`. The header is eight bytes:

| offset | what it holds |
| --- | --- |
| `0x04` | the place the picture stands at, which has to stand behind the header |

At that place stand the four bytes of the picture of the U-Me Soft kind and then its own fields, so the
measurements, the depth, whether the pixels are packed and whether a plane of alpha stands behind them all come
from there, and the pixels stand sixteen bytes behind the place the header named, with the plane of alpha as
far behind them as that picture says. The reference reads no more of the header than that place — the table of
frames, with the place and the measurements of each of them, is left unread, and the port leaves it unread as
well. A file whose place stands inside its own header, or which does not hold a picture of the U-Me Soft kind
there, is turned away, as is one whose place stands outside the file, where the reference's own reader would
throw.

The picture is handed out by the reader of the U-Me Soft kind and written out as a bitmap of the depth that
reader settles on, which is what the reference does as well; the write path of the reference throws
`NotImplementedException`, so this is a read only format, and a picture whose pixels would take more than 256
megabytes is refused.

The tests cover the four bytes of the signature and the place it names, the declines of a place inside the
header, of one standing outside the file, of one where no picture of the U-Me Soft kind stands, of four bytes a
byte away and of a header that is not all there, the measurements and the depth of the picture behind the place
it names, the pixels of a picture read from that place, the plane of alpha of a picture of three taken as the
fourth byte of every pixel, the refusals of a run that copies from before the start of the picture and of a
stream that runs out inside it, a picture too large to hold, and the fields read out of the picture behind the
place.
