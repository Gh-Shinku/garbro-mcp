# CVNS engine PB2 image

Reference: `ArcFormats/Cmvs/ImagePB2.cs`, classes `Pb2Format` (tag `PB2`) and `Pb2Reader`, which stands on the
`PbReaderBase` of `ArcFormats/Cmvs/ImagePB.cs` - the same base the ported PB3 pictures use. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License. Implemented as `cmvs-pb2-image`
(`packages/formats/src/cmvs/pb2-image.ts`).

## The head

Only the word `PB2A` stands as it is. Every byte of the head from its eighth on is keyed with the file's own
**last twenty seven bytes**: exclusive-or with one of the two bytes at places 24 and 25 of that tail, then
subtract one of the tail's earlier bytes. The fields so recovered are the size the picture was before it was
packed, how many frames it holds, the way it is packed, its width, its height and its depth, and the two
places its tables stand. A picture therefore cannot be read from its head alone.

Three of the four bytes a pixel take mean one pixel of blue, green and red; four mean a pixel with an alpha
channel as well, and the two ways that keep four channels a pixel - the fourth and the last - always take
four, whatever depth the head claims.

## The ways a picture is packed

* the **first** way packs the whole picture - blocks of eight by eight, and every byte of every pixel of them -
  as one run, and the blocks are placed **channel by channel**: every block of one channel comes before the
  next channel's first block. A block that runs past the picture's own edge is cut to it;
* the **second** way gives every channel a record of its own: two lengths, then a block of flags and a block
  of bytes, and behind them a packed plane of the blocks. A feature of a block that is set fills the whole
  block with one byte of the record and takes nothing from the plane; a clear one fills it from the plane,
  byte by byte. The records stand one after another at the head's first place, and the bytes they read stand
  at the second, each table's own size standing in a word a channel ahead of it - which is why the reader
  steps over the first four bytes a channel of both;
* the **fourth** way hands the whole picture to the walk of the JBP way, which stands behind the head;
* the **last** way keeps four channels, each packed away on its own and read from a table of its own behind
  the first nothing in the file. The colours are folded back one into the next - red against the fourth
  channel, green against that, blue against that - and the fourth channel is the alpha. Its picture is always
  written as four bytes a pixel.

The ways three, five and seven are named by the reference and **not read by it either**: they are refused by
name, with `UNSUPPORTED_FEATURE`.

## What is shared with the PB3 pictures

The reference's `Pb2Reader` and the ported PB3 reader stand on the same base, so this port reuses the walks
the project already has rather than writing them a second time:

* the LZSS walk of the base - a control byte read from its highest bit down, a **clear** bit standing for a
  byte that stands as it is and a **set** one for a pair of bytes that name a place in a frame of two
  thousand and forty-eight bytes and a run of three to thirty-four bytes - is `pb3LzssUnpack` from
  `@garbro-mcp/codecs`;
* the JBP walk of the fourth way is `pb3UnpackJbp`, handed the head's own place for the picture's alpha
  channel.

## Deviations from the reference

* Every read is bounded: a channel record that reaches past the file, a plane larger than this project will
  hold, and a picture whose size would be larger than it will hold, are all refused. The reference throws an
  end of stream error or reads past the end of its own buffer.
* The first way's block walk reads as many bytes as the blocks need; the reference does not say what happens
  when the run is shorter than that, and this port takes a missing byte as nothing.
* The last way's channel table is refused when the file holds no nothing to place it after, where the
  reference would compute a place from `-1` and read wherever that lands.
* A picture of no width, no height or no depth is refused, and so is a depth that is not eight, twenty-four
  or thirty-two bits.

## Verification

Six tests build files with a mirror writer: a head keyed with a tail that is nothing like its fields, read
back exact; a picture of the first way of ten by two pixels whose sixty bytes of blocks are placed channel by
channel, **every expected byte written out by hand** rather than by the same walk; a picture of the second way
whose first block is filled whole and whose second comes from its plane, again with hand-written expectations;
a picture of the last way whose four channels are folded back, with the expectation written from the folding
itself; the refusals, for the ways the reference does not read either; and the word, with a short file and a
wrong word both turned away.

What stands on the reference alone: no fixture here holds a *copy* of the LZSS walk - every packed plane is
written with clear control bits, so only the literal branch of that walk is reached - and no real picture is
on hand to compare against GARbro's output. The fourth way's own picture bytes are not pinned here either:
its fixture is the degenerate JBP of the PB3 tests, and this test shows only that the way reaches that walk
at the head's own place, with a bitmap of the picture's own size. That degenerate fixture does **not** come
back as the same bytes here as it does under the PB3 tests, which pin `0x80` everywhere: a four-byte pixel
sees `0x80` in its first byte and nothing in the rest, which is a property of that walk and the depth the head
claims rather than of this format, and is left for a real file to settle.
