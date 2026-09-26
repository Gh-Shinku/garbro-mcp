# Entis compressed sound (`MIO`)

Format reference: GARbro `ArcFormats/Entis/AudioMIO.cs` (`MioAudio`, `MioInput`) over
`ArcFormats/Entis/MioDecoder.cs` (`MioDecoder`, `MioInfoHeader`, `MioDataHeader`), GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

A sound of the engine stands of the head of the archives of the engine (`Enti`, the identifier of the kind
of the file and the name of it, `entis-eri` of the same head) and of the sections of the head of it: the
`SoundInf` section (the counts of the sound and the kind of the walk of the places of it) and then a chain of
`SoundStm` sections, every one of them a count of the places of the walk of the sound.

## The head of the sound

| place | field |
| --- | --- |
| 0 | the word `Enti` |
| 8 | the identifier of the kind of the file (`0x03000100` alone) |
| 0x10 | the name of the kind of the file: `Music Interleaved` alone |
| 0x40 | the head of the section `Header  ` |

The `SoundInf` section stands of the count of the kind of the sound, the kind of the walk of the places of it
(`CvType`), the kind of the counts of the walk of it (`EriCode`), the counts of the places of a colour of it,
the counts of the places of the sound of every second, the count of the places of the walk of it, the count
of the places of a colour of a count of the walk of it, the count of the places of the sound of it, the count
of the places of the walk of the counts of it and the count of the places of a count of the sound of it.

The counts of the walk of the engine stand of the sections of the head of the sound behind the places of the
places of the head of it (`Stream  `), and the counts of the walk of the engine behind the places of that
section: every count of the walk of the engine stands of a place of the count of the kind of the walk of it,
a place of the flags of the walk of it, a count of the places of the walk of the engine behind the places of
it and then the places of the count of the walk of the engine itself.

## The kinds of the walk of a sound

| kind (`CvType`) | the walk of the places of it |
| --- | --- |
| `Lossless_ERI` (`0x03020000`) | the counts of a picture of the engine alone, of a count of no sign at all and of a count of the counts behind it (`codecs/erisa-context.ts`, of the counts of the walk of the engine of the kind `RunlengthHuffman`) |
| `LOT_ERI` (`0x00000005`), `LOT_ERI_MSS` (`0x00000105`) | the walks of a picture of the engine itself (the walks of the counts of a picture, of the places of a colour and of the places of a block of it), which stand unported here |

A sound of the kind `Lossless_ERI` stands of a sound of a count of the places of the walk of the engine of
the kind `RunlengthHuffman` alone: every count of the walk of the engine stands of the counts of the walk of
the engine of the counts of a count of no sign at all and of the counts of the count of the walk of the
engine behind them, of the counts of the walk of the engine in front of it.

A sound of the kind `Architecture` `Nemesis` (`-16`) stands of a walk of the engine of its own, which the
reference stands of as well (`NotImplementedException` in `MioInput`): the sound stands of this engine, and
the places of it stand refused.

## Deviations

* The places of a sound of the kinds of the walks of a picture of the engine (`LOT_ERI`, `LOT_ERI_MSS`) stand
  refused (`UNSUPPORTED_FEATURE`): the walks of `MioDecoder` behind them stand unported.
* The whole of the counts of the walk of the engine of a sound stand of one buffer rather than of the walk
  of the places of the file of the reference block by block (`ChunkStream`, of a walk of the engine over the
  places of the file); the places of the engine are handed out as a wave file of the project.
* A sound of no count of the walk of the engine of its own stands of no sound of this engine, where the
  reference stands of it as of a sound of no places at all.
* The places of the walk of the engine of a count of sixteen places of a count stand of the counts of the
  walk of the engine of every count of a sound over each other, of the counts of the count of the walk of
  the engine itself: the places of a count of the walk of the engine stand of the counts of the walk of the
  engine of the two of them over each other, which the reference stands of as well.

## Tests

`tests/formats/entis-mio-audio.test.ts` builds a sound of the kind `Lossless_ERI` of eight places of a
sound of a count of the walk of it, of the counts of the walk of the engine of a sound of the engine itself
(the walk of the counts of a picture of the engine of the count of the walk of the engine, which the fixture
stands of an encoder of the counts of the walk of the engine of its own): the head of the sound stands
pinned, the places of the counts of the walk of the engine stand handed over as a wave file of the engine,
the places of a sound of two counts of a colour stand pinned (every count of a colour stands of the counts of
the walk of the engine of the places of it) and the places of a sound of sixteen places of a count stand
pinned as well. A sound of the kind `LOT_ERI` stands refused, and a sound of another name, of another
identifier and of no count of the walk of the engine at all stands turned away.
