# Mixwill soft image (PB00)

Reference: `GARbro/ArcFormats/Mixwill/ImagePB00.cs`, classes `Pb00Format` and `Pb00MetaData` (GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/mixwill/pb00-image.ts` (`mixwillPb00ImageDescriptor`,
`mixwillPb00ImageFormat`, id `mixwill-pb00-image`).

A picture whose channels are each a run length encoded stream of their own, behind a header of thirty-two bytes:

| offset | field |
|---|---|
| 0 | `PB00` |
| 4 | depth in **bytes** per pixel |
| 8 | width |
| 12 | height |
| 16 | the length of each of the four channel streams, one word each |
| 32 | the streams, one behind the other |

The depth word is multiplied by eight to make the depth in bits, and the whole bytes it names are the channels of
the picture: three of them make a blue-green-red-alpha pixel without its alpha, four a whole one.

## The channels

Every stream holds one byte of a pixel, and the byte it fills is **not** the one its position suggests: the
reference's order is `2, 1, 0, 3`, so the first stream of the file fills the third byte of a pixel — the channels
are stored **blue, green, red, alpha**.

Within a stream, a byte is an opcode:

* an opcode of **zero or more** counts one more than itself: that many pixels follow as they stand;
* an opcode **below zero** counts one more than its own size: one byte follows and stands for that many pixels.

The counter that decides when a stream ends counts the **bytes** of the runs rather than the runs themselves, and
it counts a run of a repeated byte as one byte — the byte that names the count, not the byte it repeats. A run of
a repeated byte therefore moves the counter one step too few, and the reader **steps over the end** of the stream
it was given and reads on into whatever follows it, which is the stream of the next channel or the end of the
header. The port keeps the counter as it stands, so that quirk is reproduced; the test named for it pins both the
run and the stray run that follows it.

A length is a **signed** word, so a stream may begin behind the one before it or inside the header itself, and the
position of the next stream is the sum of the lengths the table gives rather than where a stream really ended.
The port keeps that as well: the streams are read at the offsets the table names, whatever the runs before them
did.

A run that walks out of the pixels, and a stream whose bytes end before its length does, both stop with an error,
which is what the reference's own reads do — its pixel array is as long as the picture and its reads come
straight out of the file.

## Depths

The reference builds a bitmap out of the pixels whatever the depth says, with the format of a blue-green-red
bitmap unless there are four channels. A depth of one or two channels leaves the pixel array too short for that
bitmap and a depth of five or more walks out of the channel order — so only the depths of twenty-four and
thirty-two bits make it as far as a picture, and the port refuses any other depth with an unsupported feature
error at the point where the reference would have failed.

The reference's bitmap is built with `ImageData.Create`, which stores its rows top down; the port writes a
bitmap with a **negative height** at the same place.

The tests cover the word and a header, the channels of a twenty-four bit picture laid into the blue, green and
red bytes of its pixels, the byte counter of a run of a repeated byte with the stray run behind it, the alpha
channel of a thirty-two bit picture, a depth whose channels do not fill a pixel, and a run that walks out of the
picture.
