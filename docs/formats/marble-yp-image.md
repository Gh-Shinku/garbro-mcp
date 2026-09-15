# DarkNiteSystem image format

Reference: `GARbro/ArcFormats/Marble/ImageYP.cs`, classes `YpFormat` and `YpMetaData` — the predecessor of the
Marble YB pictures, whose `ANIM` and `DNS` containers are ported in `docs/formats/marble-anim.md` and
`docs/formats/marble-dns.md`. GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/marble/yp-image.ts` (`marbleYpImageDescriptor`, `marbleYpImageFormat`, id
`marble-yp-image`, `readYpLayout`, `unpackYp`).

The reference registers the word of nothing and checks only the two letters `'YP'` at the start of the file, so
the format is a candidate for every file that begins with them. Behind those letters stand two **three byte**
lengths, little endian: what the stream unfolds to, and how long the stream itself is — the second of which the
reference reads and never looks at again, and which the port therefore keeps in the layout without using it.
The stream begins at the end of the eight byte header and unfolds to a **Windows bitmap**, which this port reads
with the shared bitmap reader and writes out again at the depth it was stored in.

`YpFormat.LzUnpack` is twelve bit LZSS with a frame of **sixteen kilobytes**, and it turns the usual control
bit around: the bits of a control byte are read from the highest down, a **set** bit meaning a run and a clear
one a literal byte. A run takes its place in the frame from the two bytes behind the control — the low nibble
of the first byte holds the top of the place and the second byte the rest of it — and its count from a table of
the reference indexed by the low nibble of the first byte: `3…0xC`, then `0xE`, `0x10`, `0x18`, `0x20`, `0x40`
and `0x80`. The run is copied **backwards** from behind the place the frame stands at, writing into the frame
as it goes, and it is held to what is left of the picture.

The metadata pass of the reference unfolds only the first `0x36` bytes of the picture — enough for a bitmap
header — and the read pass unfolds the length the header declares. A stream that stops where a control byte is
wanted gives up and hands back what it unfolded, which is why a picture whose stream is too short is handed out
with nothing behind its last pixel rather than failing; one that stops in the middle of a literal or a run is
refused, because the .NET reader the reference uses throws there (a documented deviation in the message only).

The tests cover the two letters of the header, the measurements of the bitmap behind the stream, the bitmap
written out again, the packed length being read and never used, a stream that stops in the middle of a literal,
and — of the stream itself — a run copied backwards into what it has just written, the count table of the
reference, a run held to what is left of the picture, giving up where a control byte is wanted and the refusal
of a literal and a run the stream stops inside.
