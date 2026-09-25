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

A count of places of nothing, or an `extra` field above three, is refused, which is what the reference
does with them.

## The modes

* **0** — the samples stand as they are, and the reference hands them over through `RawPcmInput`, so this
  port writes the wave header of the head around them.
* **5** — the stream behind the head is an **Ogg** stream, which the reference hands to its own reader and
  this port hands over as it stands, under the name of the file with `.ogg`.
* **1** and **3** — the two packed modes. The reference carries a decoder of its own for them
  (`PcmDecoder`): mode 1 is an LZSS container whose walk lands in the decoder, and mode 3 is a zlib stream
  the decoder reads into the same place. The places of the decoder are then turned by a fixed point
  transform (`DecodeV1`, with two tables of its own and a twiddle table beside them) which this port does
  not carry **yet**. A sound of either mode is listed, and asking for its places is refused with
  `UNSUPPORTED_FEATURE`.
* every other mode — refused by the reference as well (`NotSupportedException`), so such a file is not one
  of the sounds this port reads and its detection stands clear.

## Deviations

* A head that declares more places than the file holds is read to the end of the file rather than refused,
  which is what the reference's own region does when it is read past its end.
* A sound of the two packed modes is detected as one of the sounds of the engine, because the reference
  knows its decoder; only the walk of the places is refused.

## Tests

`tests/formats/circus-pcm-audio.test.ts` writes the head of the reference by hand: the plain mode with a
wave format, the fifth mode with an Ogg stream, both packed modes, a count of no places, a mode the engine
knows nothing of and a mark of another engine. It pins the head, the wave the plain mode hands over (its
format block and its samples), the Ogg stream and the name it takes, the refusal of the two packed modes
at extraction, the refusals of the head, and a head that declares more places than the file holds.
