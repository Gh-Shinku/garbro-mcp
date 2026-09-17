# U-Me Soft multi-frame image, the picture kind

Reference: `GARbro/ArcFormats/UMeSoft/ArcMGX.cs`, classes `MgxFormat` and `MgxMetaData`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/umesoft/mgx.ts` (`umesoftMgxImageDescriptor`, `umesoftMgxImageFormat`, id
`umesoft-mgx-image`, `readMgxLayout`). The picture behind the header is the one ported in
[the U-Me Soft picture format](umesoft-grx-image.md), whose reader this module uses; the archive the same file
holds is ported in [the archive kind](umesoft-mgx.md).

The signature word the reference declares is `0x1A58474D`, the four bytes `MGX\x1A`, and the extensions it
declares are `grx`. The first frame's place is the last field of the twelve-byte index for a one-frame file:

| offset | what it holds |
| --- | --- |
| `0x08` | the place of the first frame |

At that place stand the four bytes of the picture of the U-Me Soft kind and then its own fields, so the
measurements, the depth, whether the pixels are packed and whether a plane of alpha stands behind them all come
from there, and the pixels stand sixteen bytes behind the place the header named, with the plane of alpha as
far behind them as that picture says. A file whose first frame does not stand wholly inside it, or which does
not hold a picture of the U-Me Soft kind there, is turned away rather than throwing the way the reference's own
reader would.

The picture is handed out by the reader of the U-Me Soft kind and written out as a bitmap of the depth that
reader settles on, which is what the reference does as well; the write path of the reference throws
`NotImplementedException`, so this is a read only format, and a picture whose pixels would take more than 256
megabytes is refused.

The tests cover the picture the file begins with found and listed, its measurements, the pixels read out of it,
and the declines of a place standing outside the file and of one where no picture of the U-Me Soft kind stands.
