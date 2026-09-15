# Toyo GSX image

Reference: `GARbro/Legacy/Gsx/ImageK2.cs`, class `K2Format`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/gsx/k2-image.ts` (`gsxK2ImageDescriptor`, `gsxK2ImageFormat`, id
`gsx-k2-image`, `readK2Layout`, `unpackK2`).

The reference registers this format under **seven words** rather than one: `K2` and then a byte that differs
between them — `0x18`, `0x20`, `0x10`, `0x0F`, `0x08`, `0x04`, `0x01` — with a NUL behind it. The word is
compared whole, so the fourth byte counts as well and a file that carries something else there is not claimed.
The file holds the length the picture unfolds to at offset six, and at `0x12` the offset of the stream, which
is counted from that same word rather than from the start of the file.

The control bits and the stream of the picture are kept **apart**. The control plane begins just past the
header — sixteen bytes on from the word the offsets are counted from — and its length is the offset of the
stream less those sixteen, capped at one bit to a byte of the picture, because a plane longer than that would
hold more bits than there are ops. The stream itself begins at the offset the file names:

* a control bit of **ones** is a byte of the picture, taken from the stream;
* a control bit of **nothing** is a run, and the control bit behind it says how its place and its length are
  written — a place of fourteen bits and a length of four bits, **three** longer than the count, or a place of
  nine bits and a length of three, **two** longer. The place is counted **backwards** from where the writing
  has come to, one further than the count it carries.

A stream that ends leaves the rest of the picture as it was — the control plane is what ends the loop — and a
byte read past the end of the stream comes out as `0xFF`, which is what the reference writes down. A run that
reaches before the start of the picture is refused with `INVALID_ARCHIVE`, where the reference's own copy would
throw. A missing control bit reads as ones, which is what the reference does with the `-1` its bit reader
returns there, so a truncated control plane takes the wide form of a run rather than the short one.

The picture is a **bitmap** in full: the reference unfolds the first fifty four bytes of it to read the header,
so a file that does not unfold to a bitmap header is not one this format claims, and the whole of it is
unfolded again to write the picture out. Nothing here writes the format.

The tests cover finding a picture behind each of the seven words, declining one whose third or fourth byte the
reference does not read, what the bitmap it unfolds to says about itself, a picture carried a byte at a time,
a run written with either form of place and length, the zeroes a control plane that ends early leaves behind,
and a run that reaches before its picture.
