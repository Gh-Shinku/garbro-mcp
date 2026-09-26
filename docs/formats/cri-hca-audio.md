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

## Deviations

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
* the refusal of the frames of the sound.

## References

- `GARbro/ArcFormats/Cri/AudioHCA.cs` — `HcaReader.ParseHeader`, `HcaReader.ReadSignature`,
  `HcaReader.InitChannels`, `HcaReader.DecodeBlock`, `HcaAudio.DefaultKey`
