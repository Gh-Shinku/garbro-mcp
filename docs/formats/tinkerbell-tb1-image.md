# TinkerBell image

Reference: `GARbro/ArcFormats/Cyberworks/ImageTB1.cs`, class `Tb1Format`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/tinkerbell/tb1-image.ts` (`tinkerbellTb1ImageDescriptor`,
`tinkerbellTb1ImageFormat`, id `tinkerbell-tb1-image`).

A **compressed twenty four bit image**: the file starts with `LEAF` (the reference's word `0x4641454C`) and the
three byte variant string `64K` at offset four, then the width (`0x0C`, word), the height (`0x0E`, word) and the
depth (`0x10`, word) — **twenty four** is the only depth the reference accepts, and any other makes it decline
the file — so the body begins at `0x18`.

The body is an LZSS stream held **inverted**: every byte the decoder takes from the file is complemented before
it is used, so the control byte, the literals and the sixteen bit match words are all stored one's complement.
The rest is the classic shape — a 0x1000 byte window starting at `0xFEE`, a control byte whose bits are read
from the **most significant** one down, which is the opposite of the library's own decoder, a set bit for a
literal and a clear one for a match whose low nibble counts `+ 3` bytes copied from the window at the offset the
high twelve bits name. That decoder is written out here as `unpackInvertedLzss` and exported, because several
other references in the tree read the same inverted stream with differences of their own; it stays local to this
format rather than shared, since those differences are not yet pinned down.

Two behaviours are worth recording:

* the count is **clamped** to what is left of the pixel buffer — the whole buffer, not the row — which is how the
  reference avoids running past its end; a test asks for the longest match a token can hold to show it;
* the reference reads **past the end** of the stream rather than stopping: its `ReadByte` answers `-1`, whose
  complement is zero, so a body that stops early decodes into zeroes and a missing match word becomes an offset
  of zero with a count of three. The port reproduces that, which is why a short body yields a blank image
  instead of an error.

`ImageData.CreateFlipped` stores the rows **bottom up**, which a bitmap records with a positive height, and the
reference passes the depth's own stride for its rows, so the bitmap is written with `bottomUp` set and tight
rows.

The tests cover the marker and the variant string, the depth gate, the metadata, a literal body, a match that
reads the bytes it writes, the clamped long match, the two short-body behaviours, and the entry name.
