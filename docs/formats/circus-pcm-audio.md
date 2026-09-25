# Circus PCM sound (`PCM`)

Format reference: GARbro `ArcFormats/Circus/AudioPCM.cs` (`PcmAudio`, `PcmDecoder`, `XpcmCompression`),
GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

## Head

The file starts with the letters `XPCM`, then

| offset | field |
| --- | --- |
| 4 | the count of the places of the sound as the head declares them (`i32`) |
| 8 | the mode (`i32`): the kind of compression in its low byte and a field the reference calls `extra` above it |
| 0x0C | for the fifth mode, the count of the places of its Ogg stream (`u32`); otherwise the wave format |
| 0x10 | for the fifth mode the stream itself; otherwise the rest of the wave format |
| 0x1C | the samples, for every mode but the fifth |

The wave format is the six fields `Wav.TryOpen` reads: the tag (`u16` at 0x0C), the channels (`u16` at
0x0E), the samples a second (`u32` at 0x10), the average places a second (`u32` at 0x14), the alignment of
a block (`u16` at 0x18) and the places of a sample (`u16` at 0x1A).

A count of places of nothing is refused, which is what the reference does with it. The `extra` field is
read by the decoder of the two packed modes alone, and only there is a field above three turned away: the
reference checks it inside `PcmDecoder`, so a plain sound of any `extra` is still one of its sounds.

## The modes

* **0** — the samples stand as they are, and the reference hands them over through `RawPcmInput`, so this
  port writes the wave header of the head around them.
* **5** — the stream behind the head is an **Ogg** stream, which the reference hands to its own reader and
  this port hands over as it stands, under the name of the file with `.ogg`.
* **1** and **3** — the two packed modes. The reference carries a decoder of its own for them
  (`PcmDecoder`): mode 1 is an LZSS container whose walk (`UnpackV1`) lands in the decoder, and mode 3 is a
  zlib stream it reads into the same place. The packed stream itself stands behind a count of its places at
  0x1C, from 0x20 on. The places the decoder holds are then put back in order, scaled, walked by a fixed
  point transform and turned into samples (`DecodeV1`, through `sub_4121C0`, `sub_411AB0` and the two
  tables of the reference), and the samples take the wave format of the head.
* every other mode — refused by the reference as well (`NotSupportedException`), so such a file is not one
  of the sounds this port reads and its detection stands clear.

## An independent reading of the same codec

The two packed modes carry a codec the reference wrote out of a disassembly. A second, independent reading of
the same codec stands in the vgmstream project (its test tool `xpcm.c`, by bnnm,
<https://gist.github.com/bnnm/ce4ca7be8950614df96b4f4f8a91c766>), which was read out of the games' own
executables as well. Step for step:

* **The tables agree.** The table of sines and cosines the reference carries (`dword_43A358`, 2048 words) is
  `trunc(cos(2*pi*k/4096) * 4096)` and `trunc(sin(2*pi*k/4096) * 4096)` for `k` below 1024, and the
  independent reading computes exactly that table. The four blocks of scales the reference carries
  (`unk_43A254`, 256 places) hold, in the first eight words of every one of them, a row of the independent
  reading's own scales place for place. Every block holds eight more words of a whole one, which the walk of
  the reference never reaches: it takes a scale every 0x1000 places of its loop, so only the first eight of
  a block stand used.
* **The window of a frame agrees.** Both readings put the odd places of a frame first and then the even ones
  out of the nibbles of the two halves of the frame (`interleave`), and both build the two arrays of the
  transform out of that window with the rule that the lowest letter of a code is its own sign (`scale`; the
  reference's own `word_6A56C8` is that table, built by `InitTable`).
* **The transform agrees**, down to the shifted sixty four bit products of every butterfly, the four block
  and two block tails, the reversion of the places, and the closing `>> 14`, which the independent reading
  writes as a division by 1024 and which the reference carries as a shift with the sign correction of a
  division.
* **The frame overlap agrees.** A frame carries 4064 samples and keeps 32 more, which the frame after it
  mixes into its first 32 places. The independent reading mixes the last 32 samples of the frame before into
  them, and so does the reference: its walk writes the places of a frame at the **sample** of the frame's own
  place while reading the places of the frame before out of the same buffer, and the two steps of a frame —
  4096 places written, 4064 places apart — meet in exactly those 32 places. The arithmetic of `DecodeV1`
  settles it: `v6 = decoded` steps by 8128 places while a frame writes 8192 of them.
* **The samples agree.** The tests of this port pin the samples of a two frame stream to the values of the
  independent reading: the places of the transform, their sum, the samples of the frame walk including the
  overlap, the lowest and the highest sample and the checksum of the whole stream.

## Deviations

* A head that declares more places than the file holds is read to the end of the file rather than refused,
  which is what the reference's own region does when it is read past its end.
* A run of the LZSS container of the first packed mode that reaches before the start of the stream, or past
  the end of the buffer the walk lands in, stops at that end and leaves the places behind it at nothing,
  where the copy of the reference throws. A sound that asks for such a run is broken either way, and a
  broken sound stops here rather than taking the read of a whole archive down with it.
* The count of the packed places stands at 0x1C and the packed stream itself from 0x20 on. The listing of a
  packed sound reports that offset with the count of the places the sound decodes to, since the reference
  hands a stream of exactly that size over; asking for the places walks them.
* A count of packed places that runs past the end of the file is refused as a broken archive, which is what
  the reference does with it (`Unexpected end of file`).

## Tests

`tests/formats/circus-pcm-audio.test.ts` writes the head of the reference by hand: the plain mode with a
wave format, the fifth mode with an Ogg stream, both packed modes, a count of no places, a mode the engine
knows nothing of, a mark of another engine and a head that declares more places than the file holds. It
pins the head, the wave the plain mode hands over (its format block and its samples), the Ogg stream and the
name it takes, the refusals of the head, and that a plain sound of any `extra` is still read while a packed
one of an `extra` above three is not.

Two kinds of the scales are walked, the `extra` field of 0 and the one of 2, so the row of scales a walk
picks out of the four kinds of the reference is checked with more than the first of them.

The stream the two packed modes walk is built by the mirror of the interleave of the reference: a frame is
written out of the codes its window should hold, and the test first asserts that the walk of this port puts
that window back together. The samples the walk has to turn out of the stream are then the ones the
independent reading of the codec turns out of it — the places of the transform and their sum, the head and
the overlap places of the samples, the lowest and the highest of them, the tail of the last frame and the
checksum of the whole stream — so an error anywhere in the interleave, the scales, the transform, the
overlap or the samples shows up as a difference.
