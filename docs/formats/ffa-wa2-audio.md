# FFA System PCM audio format

Reference: `GARbro/ArcFormats/Ffa/AudioWA2.cs`, classes `Wa2Audio` and `Wa2Input`, with the table of the two
walks of the engine from `ArcFormats/Ffa/AudioWA1.cs`, `Wa1Reader.SampleTable`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/ffa/wa2-audio.ts` (`ffaWa2AudioDescriptor`, `ffaWa2AudioFormat`, id
`ffa-wa2-audio`, `readWa2Layout`, `decodeWa2`), with the shared table in
`packages/formats/src/ffa/wa-core.ts` (`WA_SAMPLE_TABLE`).

The file begins with the word `APCM` — the word the reference registers — and then the shape of a wave file
whose format chunk stands from eight: the kind of the sound at `0x14`, the channels at `0x16`, the pace at
`0x18`, the average at `0x1C`, the size of a block at `0x20` and the bits of a sample at `0x22`. The head
the head. What is handed out is a wave file that carries the very kind, pace and size the head names, which is
what the reference's own reader does even where the kind of the head is not plain samples.

The walk takes the high four places of a byte first and the four lower places of it behind them. What a place
gives is the step the walk stands at times the odd number its three lowest places name, less three places of
the same, and the sample climbs by that step or — where the highest place of the place stands — falls by it,
held at the greatest and the least of sixteen bit samples. The walk then moves along: the step it stands at
times what `Wa1Reader.SampleTable` gives for the place, less six places, and where that stands above a hundred
and twenty seven the walk stands there, up to the greatest step of `0x6000`, and where it does not the walk
stands where it began, at `0x7F`.

less than that, the sound behind it stands as nought, which is what the reference's own read of the file does.

Deviations from the reference, in the message only: a file whose head does not carry the shape of a wave file,
a head that names no channels or no pace, a sound of no bytes and a head that does not stand inside the file
are refused, where the reference would throw an `InvalidFormatException`.

The tests cover the head, the word, the shape and the sizes it is turned away for, a walk of three bytes
worked out place by place, a walk of places whose highest bit stands and the falling chain they give, a sound
whose walk gives less than the head says, a sound written out as a wave, and a file that does not hold a
sound.
