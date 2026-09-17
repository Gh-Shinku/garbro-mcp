# ZyX image format

Reference: `GARbro/ArcFormats/Zyx/ImageXMG.cs`, class `XmgFormat`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/zyx/xmg-image.ts` (`zyxXmgImageDescriptor`, `zyxXmgImageFormat`, id
`zyx-xmg-image`, `decryptXmg`, `convertXmgPalette`, `readXmgHeader`, `unpackXmg`).

The reference declares no signature: it only looks at a file whose name carries the `.xmg` extension. The
first twelve bytes are obfuscated, and so is the colour map behind them, by `XmgFormat.Decrypt`: every byte
is shifted down by a key that starts at nothing for the header and at `12 * 7` for the colour map, steps by
seven per byte and is then turned over by `0xf3`, all held to eight bits. Behind the tag word the header
must have two clear bytes, and the width and the height are read as **signed** words of which neither may be
zero or less. The depth is always reported as eight bits, and a picture of no size is turned away.

The colour map holds two hundred and fifty six three byte entries, which `ConvertPalette` reads as red, green
and blue from the **second, third and first** byte of each, so the entries of the file stand blue, red, green.
The port turns them into the four byte entries a bitmap wants without changing which colour is which. A file
whose colour map is not all there is refused, which is the reference's own length check.

The pixels are a walk of six bit counts, taken a row at a time: a row reads commands until its own width is
filled, and the walk keeps its place across the row edge while the column count starts over. A control byte
with its two highest bits clear holds that many literal pixels, a count of nothing meaning the byte behind it
plus `0x40`. A control byte whose highest bit is clear repeats the pixel before it, one more than the same
count. A control byte whose highest bit stands copies a run from behind the place it stands at: the low twelve
bits of the control byte together with the byte behind it are the distance, and the three bits in the middle of
the control byte are the count — a count of nothing meaning the byte behind it plus ten, and two more than
either says. The run is copied forwards, so it reads what it has just written.

The reference reads the literals of a run from the stream with a short read that leaves the rest of them as
they stand, and it reads a control byte as `0xff` past the end of a memory backed stream; the port refuses a
stream that stops where a command or a literal is wanted and a command that writes past the picture, both of
which the reference's file backed reader answers with an exception (documented deviations in the message
only). A distance that would read before the start of the picture is refused the same way, since the
reference's own copy would read whatever stands there. A picture whose pixels would take more than 256
megabytes is refused rather than allocated. The write path of the reference throws
`NotImplementedException`, so this is a read only format.

The tests cover the extension gate, the two clear bytes behind the tag word and the measurements; the
measurements the port reports; the colour map turned through the reference's own rotation and written out
again; the walk of a two by two picture whose second row repeats the last pixel of the first; a literal run
whose count of nothing stands for sixty four; a repeat counting one more than the control says; a copy that
repeats what it writes; the low nibble of a control byte acting as the high distance bits; a stream that
stops where a command or a literal is wanted; and a command that writes past the picture.
