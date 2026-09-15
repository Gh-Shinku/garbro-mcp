# Hypatia compressed audio format

Reference: `GARbro/ArcFormats/Hypatia/AudioADP.cs`, classes `AdpAudio` and `AdpDecoder`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/hypatia/adp-audio.ts` (`hypatiaAdpAudioDescriptor`,
`hypatiaAdpAudioFormat`, id `hypatia-adp-audio`, `readAdpLayout`, `decodeAdp`).

The signature word the reference declares is `0x31504441`, the letters `ADP1`, and it declares no extensions.
The header is sixteen bytes:

| offset | what it holds |
| --- | --- |
| `0x04` | how many samples the sound holds, counted for one channel |
| `0x08` | the rate of the samples, which has to stand between eight thousand and ninety six thousand |
| `0x0C` | the channels, of which there may be one or two |

The sound is always sixteen bit samples. A count of no samples, a rate outside the band above and a channel
count that is not one or two are all turned away. The count of the samples is taken once for every channel, so
a sound of two channels holds twice as many as the header says, and the entry of the wave file it is written as
is not as long as the file it stands in.

The stream behind the header is read four bits at a time. A nibble names a step of the decoder's table of
sixteen, which is taken against the quantiser the decoder stands at and put on top of the sample before it;
the sum is held inside what a signed word can carry and becomes the sample. The same nibble then steps the
quantiser by one of five amounts — nothing, two, four, six or eight, the last four of which come with the
steps that may stand below nothing — and the quantiser is held between its first step and its forty ninth.

The low nibble of a byte is read first. A sound of one channel takes the high nibble next and stands both of
them through the same decoder, so one byte is two samples of that channel; a sound of two takes one nibble to
a channel, each with a decoder of its own, so one byte is one sample of each channel. The count of the samples
ends the walk — a count that comes out odd ends it after a low nibble — and a stream that runs out before the
count leaves the rest of the sound at nothing.

The reference hands the sound out as a stream of raw samples; the port writes it as a wave file. The write path
of the reference throws `NotImplementedException`, so this is a read only format, and a sound that would unfold
to more than 256 megabytes is refused.

The tests cover the four bytes of the signature, the declines of a rate below the band or above it, of a
channel count other than one or two, of a count of no samples or fewer than none and of a header that is not
all there, the format reported for the sound and the count of the samples of a sound of two channels, the wave
file it is written as, the walk of the quantiser along the four bits with a sound of one channel and of two,
the samples held inside what sixteen bits carry, the rest of a sound the stream is short of left at nothing,
a sound too large to hold, and the nibbles of a sound read on their own.
