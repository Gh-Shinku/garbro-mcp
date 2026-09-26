# Audio Interchange File Format (`AIFF`)

Format reference: GARbro `ArcFormats/AudioAIFF.cs` (`AiffAudio`, `AiffInput`), GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

The reference lays out nothing of this format itself: `AiffAudio.TryOpen` hands the stream over to
`NAudio.Wave.AiffFileReader`, and `AiffInput` takes the places of the sound (the counts of it, the places of a
sample, the places of the stream of it) straight out of that reader. Nothing of the walk of the chunks is
written down in the reference at all, so this port stands of the format itself: the chunks of a `FORM` of the
kind `AIFF` (or of the kind `AIFC`), the places of a sound of `COMM`, and the places of the samples of `SSND`.

## The walk of the chunks

| chunk | places |
| --- | --- |
| `COMM` | the counts of the sound (`u16`), the count of the places of the sound (`u32`), the count of the places of a sample (`u16`), the count of the places of a sample every second of the other way of the engine (ten places, of a place of a sign, a place of an exponent and a mantissa of sixty four places), and — of the kind `AIFC` — the name of the kind of the places of the samples behind them |
| `SSND` | a count of the places of the walk in front of the samples, a count of the places of a block, and the samples |

Every chunk of the format stands of a count of an even number of places behind it, which this port steps over
the way the format does. The count of the places of the sound of `COMM` stands of the *sound* rather than of
the places of the samples of the file, so the walk of this port hands the samples of `SSND` out as they stand.

## The kinds of the places of the samples

| name of the kind | walk |
| --- | --- |
| `NONE`, `twos` | the places of the samples stand of the other way of the engine; the port turns every place of a sample over into the places of the engine |
| `sowt` | the places of the samples stand as they are |
| every other name | the places of a sound of a kind of its own, which the reference hands over to its reader as well: refused |

A count of the places of a sample that stands of a place of a bit of its own (a count of twelve of them, and
their like) is refused as well rather than guessed at.

## The sound of the port

The places of the sound are handed out as a wave file of the project: a count of the places of a sample of
sixteen of them of a sound of one place of it is turned into sixteen places of the engine rather than of the
other way of it. Nothing of this format stands of an archive of the engine, so the entry of the walk stands
of the name of the file itself, of the places of `wav`.

## Deviations

* The reference asks its reader for a count of the places of the sound of every second (`SourceBitrate`) and
  for a count of the places of the samples (`PcmSize`) that stand of the reader rather than of the file; this
  port hands out a wave file of the places of the file instead and names it `sizeKnown: false`, the way the
  rest of the audio ports of this project do.
* The count of the places of a sample of the other way of the engine of the format stands of an exponent of
  fifteen places and a mantissa of sixty four of them, of which this port stands of the places of a count of
  this project (`Number`): a count of a sound of the places of a sample past those of a count of it stands of
  the count behind it.
* A chunk of a count that reaches past the places of the file names no chunk of it rather than a failure, and
  a file of the word `FORM` of no places of a sound at all stands refused where its places are asked for.

## Tests

`tests/formats/gameres-aiff-audio.test.ts` builds a sound of the kind `AIFF` of two places of a sample of the
other way of the engine — whose word of `COMM` is read back and whose samples stand turned over in the wave
file of the walk — and a sound of the kind `AIFC` of the places of the samples of the engine as they stand
(`sowt`), which stands of the places of the samples of the file as they are. A sound of the kind `ima4` is
pinned beside them as a sound of this format whose places stand refused, and a form of another kind, a form
of no places of a sound at all and a file that stands short of a head are turned away.
