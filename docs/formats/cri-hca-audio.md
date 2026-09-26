# Cri engine sound (`HCA`)

Reference: GARbro `ArcFormats/Cri/AudioHCA.cs` — classes `HcaAudio`, `HcaInput`, `HcaReader` — at GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

A sound of the Cri engine is a big endian container: a word of the head, a walk of the counts of the sound, and
then the frames of it. This port reads the word and the walk of the counts; the frames stand unported, and
extraction of them is refused with `UNSUPPORTED_FEATURE`.

## The word of the head

The reference reads every word of the head through `HcaReader.ReadSignature`, which stands of the high bit of
every byte of the word cleared. The word of the head is `HCA` with the low byte of it free, so a head whose
bytes stand of their high bits stands of the same counts. The port clears the same bits, so it reads those
heads as well.

Two counts follow the word:

| offset | field |
| --- | --- |
| 4 | word of the version |
| 6 | the place of the frames of the sound |

## The walk of the counts of the head

Every count of the head is four bytes of a name and then a body of a fixed size; the reference names no count
of the places of a count at all. The walk stands of no place beyond the place of the frames, so it stands of
the counts of the walk of the engine:

| name | body |
| --- | --- |
| `fmt` | the counts of the channels and the places of the sound (four bytes: sixteen bits of the count of the channels above twenty four of the count of the places of the sound), the count of the blocks of the sound, four bytes of no count |
| `comp` | the count of the places of a block (two bytes), eight counts of the walk of the places of a block, two bytes of no count |
| `loop` | twelve bytes, which the reference steps over |
| `ciph` | two bytes of the kind of the cipher of the sound |
| `rva` | four bytes of the places of the count of the walk of the sound |
| `ath` | two bytes of the kind of the table of the counts of the places of the sound |

A count the reference does not know **ends the walk** and leaves the counts behind it at their places of no
count at all. A head of a sound of the engine in common use carries a count of the places of the walk of a
sound of the engine (`dec`) that the reference does not name, so in practice the walk of the reference ends at
that count: the kind of the cipher stands at no count at all and the kind of the table of the counts of the
places of the sound stands of the word of the version of the head (one for a sound of an older version, no
count at all otherwise). The port keeps that behaviour, and the tests pin both walks: with a count the
reference does not know in front of the counts of the cipher and of the table, and without it.

## The counts the head gives

* The count of the channels of the sound has to stand between one and sixteen, and the count of the places of
  a block of the walk of the engine has to stand of eight places at the least; a head of any other counts is
  refused.
* `CompParams.R9` is the count of the places of the counts of a block. The reference works it as
  `t / R[7] + (t % R[7] != 0 ? 1 : 0)` for `t = R[4] - (R[5] + R[6])`, where the division of C# stands of
  toward zero and the remainder stands of the sign of `t`. For a count of the places of the counts behind
  zero, the count of the places of them therefore stands *above* the count the places of them work out to:
  the port keeps that, and the tests pin it (`t = -7`, `R[7] = 2` gives `-2`, not `-3`).
* The counts of the places of the channels of the sound stand of `HcaReader.InitChannels`, which names the
  places of the channels that stand of the counts of the places of a block of the walk of the engine. The port
  keeps the switch of the reference, where the counts of four, five, six, seven and eight places stand of the
  counts of the smaller counts of places as well.

## The counts of the places of the sound and the cipher of it

Behind the counts of the head the reference builds two counts of its own, before it walks the frames of the
sound.

* The table of the counts of the places of the sound (`AthTable`) stands of the kind the head names and of the
  count of the places of the sound: of no counts at all for the kind of no count of them, and otherwise of the
  counts of the list of the engine, which the count of the places of the sound names at every count of the
  places of the counts of the walk of the engine. The reference adds the count of the places of the sound
  **twice** at every count of the places of the counts of the walk of the engine, once within the count of
  itself and once at the count of the count of them that stands behind it, and stands of the last places of the
  counts of them at every count behind the counts of the list.
* The cipher of the sound (`Cipher`) stands of the table of the counts of the places of a sound of the engine
  of the places of the counts of the walk of the engine, and the places of the counts of the walk of the engine
  stand of it count by count. The reference reads the kind of the cipher from the head, but stands of the kind
  of no cipher at all wherever the key of the engine stands of no counts of it, whatever the head says.

The count of the key of the engine is the `DefaultKey` of the reference, `0x30DBE1AB` and `0xCC554639`, which
the engine of the sound of the engine of the places of the picture of the engine of one game stands of rather
than the head of a sound. The cipher of the kind of the key of the game (the kind of the count of fifty six
places) stands of `throw new NotImplementedException ("Encrypted HCA streams not implemented")` in the
reference: this port refuses such a sound at the head of it, as the reference does, so a sound of the engine
of that kind of cipher stands detected by neither.

## The counts of a frame of the sound

A frame of the sound is a block of the size the head names: two counts of the walk of the engine at the end of
it, which stand of the counts of the places of the block itself (`CheckSum`, the walk of the engine of the
counts of the places of a block of the walk of the engine over its own counts), and behind them the counts of
the walk of the engine of the places of the picture of the engine.

* The counts of the walk of the engine of the places of the picture of the engine (`HsaBitStream`) stand of the
  places of the frame, of the counts of the places of the picture of the engine of the count of the walk of the
  engine that stand in front of them. A walk of the engine behind the end of the frame stands of no count of
  the places at all, and the walk of the engine of the counts of the places of the picture of the engine
  (`Seek`) stands of the count of the places of the frame that stands behind it.
* The counts of the places of a picture of the engine of a sound of the engine (`Channel.Decode1`) stand of the
  counts of the walk of the engine of the places of the picture of the engine of the counts of the places of a
  block of the walk of the engine, which stand of the table of the counts of the places of the sound of the
  engine, of the counts of the places of the counts of the walk of the engine of the table of the places of it
  and of the count of the places of the walk of the engine itself.
* The counts of the places of a picture of the engine of a count of the walk of the engine (`Channel.Decode2`
  and `Channel.Decode3`) stand of the counts of the places of the picture of the engine of the counts of the
  walk of the engine that stand in front of them, of the counts of the walk of the engine of the table of the
  counts of the places of them, and of the counts of the places of a picture of the engine of a count of the
  walk of the engine that stands behind it (`Channel.Decode4`).

Behind those counts stands the walk of the counts of a picture of the engine of the engine itself
(`Channel.Decode5`): the counts of the places of the picture of the engine of a count of the walk of the engine
stand of the counts of the places of the walk of the engine of the counts of them, and then of the counts of
the places of the picture of the engine of the count of the walk of the engine that stands in front of them,
which stand of the counts of the places of the picture of the engine of the count of the walk of the engine
that stands behind it. Every frame of the walk of the engine stands of `0x400` places of a colour for every
count of the places of the sound of the engine, which stand of the counts of the places of the sound of the
engine in the order of the walk of the engine, and the extraction of a sound of the engine stands of a wave
container of sixteen places of the counts of the places of the picture of the engine.

A frame of the walk of the engine of no counts of the walk of the engine at all - the word of the head of the
frame of no count of them at all - stands of the counts of the places of the picture of the engine of the frame
that stands in front of it, which the reference stands of as well: the counts of the places of the picture of
the engine of the frame that stands in front of it stand for the frame that stands behind it.

## Deviations

* The reference hands the counts of the places of the sound of the engine out as single precision counts of
  the places of the picture of the engine (`ConversionFormat.IeeeFloat`, which its own `TryOpen` stands of);
  this port stands of the counts of sixteen places of the counts of the places of the picture of the engine
  (`ConversionFormat.Pcm`, the `PackSample16` of the reference, of the counts of the places of the picture of
  the engine that stand of `0x7FFF` and stand of the counts of the engine itself outside them). The walks
  themselves stand of the counts of the engine of this project, which stand of no counts of the places of the
  picture of the engine of the count of the places of the engine itself where the reference stands of a single
  count of them.
* The port reads the whole file to reach the head. The reference reads the head in place and then stands of
  the frames where the head names them; the head of this port is read once and the frames stand behind it.
  Extraction stands unported, so nothing stands of the frames.
* The port refuses a head whose count of the places of a block of the walk of the engine does not stand of
  the count of the channels of the sound (`InitChannels` divides one by the other): the reference works the
  counts out anyway and could stand of a place behind the counts of the places of the channels of it.
* The port refuses a head whose place of the frames stands behind the end of the file, which the reference
  finds only where it stands of the first frame.
* The reference works of the count of the places of a frame of the sound twice, and the two do not agree: it
  hands the counts of the places of the sound as `block_count * 0x80 * channels * bits`, while every frame of
  it stands of eight counts of `0x80` places for every channel. This port names the counts of the places of
  the sound of the *walk*, and the tests pin that count.

## Tests

`tests/formats/cri-hca-audio.test.ts` builds heads in the test:

* the word and the counts of the walk of the head of it: the counts of the channels, the places of the sound
  and the blocks of it, the kind of the cipher and of the table, the places of the frames of the sound behind
  the walk and the path of the sound the port hands out,
* a head whose bytes stand of their high bits, which the reference reads as well,
* the walk of the counts of the head of it at a count the reference does not know, in front of the counts of
  the cipher and of the table and without it, and the counts of the walk of the engine of a head of no counts
  of them at all,
* the counts of the places of the channels of the sound, for the counts of two, three, four, six and eight
  places of a block, and for a sound of no counts of the walk of the engine at all,
* the count of the places of the counts of a block, in front of zero and behind it,
* the refusals: a word of another sound, a head too short to hold the counts of the walk of the engine, a
  sound of no channels at all, of more than sixteen channels, of a count of the places of a block behind eight
  places, and of no counts of the walk of the engine at all,
* the refusal of the frames of the sound,
* the counts of the places of the sound of the engine: the kind of no counts of them and the kind of one
  count, of the count of the places of the sound of the engine itself, of the counts of the places of the
  counts of the walk of the engine of the table of the engine and of the count of the places of the counts of
  them that stands behind the last count of them,
* the cipher of the sound of the engine: the kind of no cipher at all (the places of the counts of the walk of
  the engine of the sound itself), the kind of one count (the counts of the places of the counts of the walk
  of the engine of the cipher of the engine, which stand of every count of them) and the places of a count of
  the sound of the engine of the walk of the engine of the cipher of it,
* the refusals of the counts of the table of the places of the sound and of the cipher of it: a kind of the
  table of the places of the sound the reference names no counts of the walk of the engine of, a kind of the
  cipher of the key of the game, and a kind of the cipher of no count of the walk of the engine at all,
* the counts of the places of a block of a sound of the engine: the counts of the walk of the engine over the
  counts of a block, of the counts of the places of the block itself and of the count of the places of the
  counts of the walk of the engine of the block that stand at the place of the block,
* the counts of the walk of the engine of the places of the picture of the engine: the counts of the counts of
  the walk of the engine at the places of the picture of the engine of a sound of the engine, the walks of the
  engine behind the end of a sound of the engine, and the counts of the walk of the engine of the counts of the
  places of the picture of the engine itself,
* the counts of the places of a picture of the engine of a sound of the engine: the counts of the counts of the
  walk of the engine of the counts of the places of the picture of the engine of the engine itself, of the
  counts of the places of the picture of the engine that stand in front of them, of the places of the counts of
  the walk of the engine that stand behind the counts of the walk of the engine of the picture of the engine
  itself, and of the counts of the places of the walk of the engine of the counts of the places of the picture
  of the engine behind them (`Channel.Decode1`, `Decode2`, `Decode3` and `Decode4`),
* the walk of the counts of a picture of the engine of the engine itself (`Channel.Decode5`) and the counts of
  the places of the picture of the engine of the walk of the engine that stand of it, of the counts of the
  places of the sound of the engine of every frame of the walk of the engine,
* a sound of the engine of the counts of the places of a picture of the engine of no counts of the walk of the
  engine at all, which stands of the counts of the places of the picture of the engine of the frame that stands
  in front of it, and of a frame of no counts of the walk of the engine at all,
* a wave container of a sound of the engine of the counts of the places of the picture of the engine of the
  walk of the engine, of the counts of the places of the sound of the engine of the head of it,
* the refusals of the frames of a sound of the engine: a frame of the counts of the walk of the engine of a
  count of the places of the block of the walk of the engine that stands behind the counts of the places of the
  block itself, and a frame that stands behind the end of the sound of the engine.

## References

- `GARbro/ArcFormats/Cri/AudioHCA.cs` — `AthTable`, `Cipher`, `HcaReader.ParseHeader`, `HcaReader.ReadSignature`,
  `HcaReader.InitChannels`, `HcaReader.DecodeBlock`, `HcaReader.ConvertSequential`, `Channel.Decode1`,
  `Channel.Decode2`, `Channel.Decode3`, `Channel.Decode4`, `Channel.Decode5`, `HsaBitStream`,
  `HcaReader.CheckSum`, `HcaInput.PackSample16`, `HcaAudio.DefaultKey`
