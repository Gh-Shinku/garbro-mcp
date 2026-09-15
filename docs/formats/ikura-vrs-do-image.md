# D.O. image format

Reference: `GARbro/ArcFormats/Ikura/ImageVRS.cs`, classes `DoFormat` and `DoReader`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/ikura/do-image.ts` (`ikuraDoImageDescriptor`, `ikuraDoImageFormat`, id
`ikura-vrs-do-image`, `readDoLayout`, `unpackDo`).

The reference signs the format with the word `0x4F44`, the two letters `DO`, and the port matches those two
letters. Behind them stand two bytes of nothing, the measurements and a colour map of two hundred and fifty
six entries of three bytes, which the reference reads as red, green and blue from the **second, third and
first** byte of each entry — so the colour map of the file itself stands blue, red, green, and the port turns
it into the four byte entries a bitmap wants without changing which colour is which. A file whose colour map
is not all there is refused, which is the reference's own length check, and a picture of no width or height is
turned away as well. The depth is always reported as eight bits.

The stream behind the colour map is a walk of three kinds of run, told apart by the two highest bits of a
control byte:

| control | what it does |
| --- | --- |
| below `0x40` | that many pixels stand in the stream themselves, a count of nothing meaning the byte behind the control plus `0x40` |
| `0x40` to `0x7F` | that many repeats of the pixel before the run, one more than the control says, a count of nothing again meaning the byte behind it plus `0x40` |
| `0x80` and above | a run copied from a place behind, whose low nibble holds the top of the place and the byte behind the control the rest of it, of which the count stands in the three bits behind the highest one — nothing there meaning the byte behind the control plus eight — and always two more than either says |

The last kind copies from behind the place it stands at one byte at a time, so a copy from one place behind is
a run of the pixel before it and a longer one reads what it has just written. Since the three bits of the
control byte hold the count plus two and a count of nothing means ten pixels or more, no run of that kind can
be shorter than six pixels: the counts between two and five have no way of being written at all.

The reference reads the pixels of a run of the first kind from the stream, so one that stops early leaves the
rest of those pixels as they stand and the walk carries on — but a stream that stops where a control byte is
wanted is refused, as is a walk that reaches outside the picture, which the reference's .NET reader answers
with an exception as well (documented deviations in the message only). A picture whose pixels would take more
than 256 megabytes is refused rather than allocated. The write path of the reference throws
`NotImplementedException`, so this is a read only format.

The tests cover the two letters of the signature, the declines of a picture of no width or height and of one
whose colour map is not all there, the measurements, the colour map written out in the order a bitmap wants,
a run of pixels that stand in the stream themselves in the short and the long form, a run repeating the pixel
before it in the short and the long form, a run copied from a place behind in the short and the long form, the
pixels a run leaves as they stand where the stream ends inside it, the refusal of a repeat at the first pixel,
of a copy with nothing behind it, of a run longer than the picture and of a stream that stops where a control
byte is wanted, a picture too large to hold, and the walk of a picture of one row.
