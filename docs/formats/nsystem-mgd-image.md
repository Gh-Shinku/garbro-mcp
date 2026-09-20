# NSystem image (`MGD/NSystem`)

Reference: GARbro `ArcFormats/NSystem/ImageMGD.cs`, classes `MgdFormat` and `MgdDecoder` (GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License). Implemented as
`packages/formats/src/nsystem/mgd-image.ts`, registered as `nsystem-mgd-image`.

The tag carries its engine because another one uses the same three letters: the Masys resource archive is
already ported as `masys-mgd`, a different format from a different engine that happens to share the name.

## The header

| offset | field |
| --- | --- |
| 0 | `MGD ` |
| 4 | where the picture data starts |
| 0x0c | the width |
| 0x0e | the height |
| 0x10 | the size the picture unpacks to |
| 0x18 | the mode, which the reference requires to be 0, 1 or 2 |

The header declares four bytes to a pixel whatever the mode stores, so the unpacked size is the frame times
four.

## Mode 0: stored pixels

A length word, then that many bytes of pixels. The reference then looks at every fourth byte: if any of
them is not zero the picture is treated as having an alpha channel, and it is a plain colour picture
otherwise. The port writes thirty two bits when the alpha channel is in use and twenty four when it is not,
so the unused byte of the plain case does not arrive as a transparent pixel.

## Mode 1: a packed pair of channels

The stream opens with a length word this mode's reader never looks at, and then two channels, each with a
length of its own:

* the **alpha channel** is a sequence of counts, two bytes each. A count word of `0x8000` and up is a run of
  `(count & 0x7FFF) + 1` pixels that share the value byte which follows, so three pixels are the word
  `0x8002`; any other count is that many value bytes, one to a pixel. The mode reports alpha only if one of
  those values is not zero.
* the **colour channel** is a sequence of groups, each introduced by a flag byte whose top two bits pick the
  kind and whose low six bits give the count:
  * a literal group carries `count` pixels of three bytes each;
  * a run group carries one pixel and repeats it to `count` more;
  * a difference group carries two bytes per pixel, each applied to the pixel in front of the group. With
    the top bit set the three channels take five bits each, added; otherwise each channel carries four
    bits and a sign bit of its own, so red uses `0x4000` and bits 10 to 13, green `0x0200` and bits 5 to 8,
    and blue `0x0010` and bits 0 to 3. A channel that goes short of zero wraps, as the reference's cast to a
    byte does.

## Mode 2: a picture of another kind

The payload is a whole portable network graphic, which the reference hands to the Windows imaging stack.
This project carries no such decoder, so the mode raises `UNSUPPORTED_FEATURE` with that reason rather than
guessing.

## Deviations from the reference

* Every read is bounded and every write stays inside the declared unpacked size, both raising a
  `GarbroError`; the reference lets an array access throw.
* Mode 0 copies exactly the frame's worth of bytes from the stored data, where the reference hands the whole
  stored range over whatever the header declared.
* A count of zero in the alpha channel's list form is walked past, since the reference reads another count
  there and so reaches the end of its stream.
* The packed mode's two channel lengths are not checked against each other, as in the reference.

## Verification

Eight fixtures in `tests/formats/nsystem-mgd-image.test.ts` cover the header and its rejections, stored
pixels both with and without an alpha byte, a packed colour channel using all three group kinds, a
difference in the four bit form that takes one channel short of zero (leaving `0xfb`), both forms of the
alpha channel, the bitmap depth each case calls for, a picture whose data reaches past the file, the mode
that holds a picture of another kind, and detection, listing and extraction through the registered format.

Writing the tests found a mistake in the port: the packed mode reads a length word the decoder never uses
before its alpha length, so the alpha channel sits a word further in than it first appeared.
