# LZSS-compressed bitmap

Reference: `GARbro/ArcFormats/ImageLZS.cs`, classes `LzsFormat` and `LzsMetaData`, which stand in the
`GameRes.Formats.Misc` namespace. GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/misc/lzs-image.ts` (`miscLzsImageDescriptor`, `miscLzsImageFormat`, id
`misc-lzs-image`, `readLzsLayout`, `decompressLzs`). The sibling format of the same namespace, which keeps its
picture behind a stream of the Microsoft kind, is ported in `packages/formats/src/misc/lz-bmp-image.ts`.

The signature word the reference declares is `0x53535A4C`, the letters `LZSS`, and it declares no extensions.
The header is sixteen bytes:

| offset | what it holds |
| --- | --- |
| `0x08` | how much the picture unfolds to |
| `0x0C` | a byte of which the lowest three bits say whether the picture stands behind a stream |

Behind the header stands either the bitmap itself — a picture whose flag is clear keeps it at `0x1C` — or the
stream, which begins at the end of the header and unfolds to a dozen bytes and then the bitmap; the two places
are not the same, which is what the reference does. The measurements come from the bitmap either way, and a
listing reads only the first sixty six bytes of what the stream unfolds to.

`LzsFormat.Decompress` reads its control bits from the highest downwards, a byte of them at a time. A bit that
stands at one stands for a byte of the picture that stands in the stream itself. A bit that stands at nothing
stands for two bytes, the highest twelve bits of which are a place behind the picture and the lowest four a
count: a place of nothing stands for a run of bytes that stand in the stream themselves, of sixteen to thirty
and a byte more, and any other place for a run copied from behind, of three to eighteen and a byte more, which
may reach into what the run has just written. Both kinds of run are held to what the picture still holds room
for, so a run that asks for more than that is cut short rather than refused; a stream that runs out inside the
picture is refused, where the reference's own reader throws, and so is a copy whose place reaches before the
start of the picture.

The picture is handed out by taking the bitmap apart and writing it out again, which is what `Bmp.Read` does.
The write path of the reference throws `NotImplementedException`, so this is a read only format, and a picture
that unfolds to more than 256 megabytes is refused.

The tests cover the four bytes of the signature, the declines of a header that is not all there, of four bytes
that are not the ones the reference declares and of a stream that does not unfold to a bitmap, the measurements
of a picture that stands behind a stream and of one that stands in the file as it is, the bitmap of a picture
of either kind written out as it stands, a copy of a run out of the bytes the stream has just unfolded, a run
of bytes that stand in the stream themselves in the short and the long form, a copied run in the long form,
the refusals of a stream that runs out inside the picture and of a run that copies from before the start of the
picture, a picture too large to hold, and the bytes of a stream read on their own.
