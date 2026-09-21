# Wild Bug WBM image

Reference: `ArcFormats/WildBug/ImageWBM.cs`, classes `WbmFormat` and the `WbmReader` behind it, whose nine
packed walks stand on the `WpxDecoder` base. The head and the record walk are shared with the ported sound
of the same engine (`wildbug/wpx-section.ts`). GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`.
Implemented as `wildbug-wbm-image` (`packages/formats/src/wildbug/wbm-image.ts`).

## What this port reads

A picture of this engine is told from a sound of it by the three bytes behind the word both carry: `BMP`
here, `WAV` there. The records behind the head are the same in both.

* the record that opens with `0x10` holds the picture's own head: the width and the height as two words, and
  the depth it is stored in at `0x0C`. The depth picks how many bytes a pixel takes, eight bits taking one,
  sixteen two, twenty four three and thirty two four; any other depth is refused, as the reference refuses
  it;
* the record that opens with `0x11` holds the pixels, padded to four bytes a row;
* the record that opens with `0x12` holds the colours of an eight bit picture, three bytes each, up to two
  hundred and fifty six of them. A picture of eight bits without that record is read as shades of grey,
  which is what the reference's own `Gray8` means;
* the record that opens with `0x13` holds an alpha channel for a picture of twenty four bits or more, one
  byte to a pixel and padded to four bytes a row. It is spread over the pixels into a four byte picture, and
  a channel the reader cannot produce leaves the picture without one - which is what the reference's own
  catch does.

## What this port does not read, and says so

Nine ways of storing a section are gathered in the reference's `WbmReader`, chosen by the second byte of the
section's record: `UnpackV0` through `UnpackVD`, for the ways `0x00` to `0x0F`. Each builds a reference
table of sixty four thousand entries (`BuildTable`, `FillRefTable`) and then walks the picture through a
padded table of eight pixel offsets (`GenerateOffsetTableV1` or `V2`), retrying with another version of that
table when a walk fails. All of that code is decompiler output in the reference (`sub_40919C`, `sub_46C26C`),
so a port has nothing to check its own transcription against but the reference itself.

This port reads the one way the reference also reads as it stands: a section whose format has the top bit
set, `0x80`, or one that declares no packed length at all. Anything else is refused with
`UNSUPPORTED_FEATURE`, and the message names the walk the section's byte asks for, so a caller learns which
of the nine is missing rather than being handed a wrong picture.

## Deviations from the reference

* The nine packed walks are refused rather than ported, as above.
* Every read is bounded: a picture shorter than the size its head names, and a section reaching past the end
  of the file, are refused, where the reference would throw an end of stream error or keep zeros.
* A picture of no width or no height, and a depth the engine never writes, are refused.
* The decoded rows are padded to four bytes, while every bitmap writer of this project takes rows that stand
  one behind the other, so they are unpadded before the bitmap is written. The alpha merge walks by the pixel
  size and needs no such step.

## Verification

Eight tests build files with a mirror writer: a stored picture of twenty four bits whose padded rows come out
of the bitmap without padding; a picture of thirty two bits whose alpha channel is spread over it (the byte
the picture keeps behind its colours is deliberately different, so a port that kept it would fail) and whose
second row of alpha starts where its own four byte stride says; a picture of thirty two bits with no alpha
channel, which is left alone; a picture of eight bits read through its colours, checked both in the decoded
table and in the bitmap, whose colours are turned round from red first to blue first; a picture of eight bits
without colours, read as shades of grey; a picture of sixteen bits, whose bitmap declares the five bit masks;
a packed section refused with the name of the walk it asks for, beside the same section declaring nothing
packed, which is read as it stands; and the refusals - the word of a sound, no head, a head too short, a
depth of twelve, no pixels, and pixels reaching past the file.

What stands on the reference alone: the nine packed walks, which this port refuses, and no fixture is on
hand to pin them down; and no real file is on hand to compare against GARbro's output.
