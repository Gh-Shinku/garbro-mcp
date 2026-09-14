# AnimeGameSystem PCM audio (PCM/AGS)

Reference: `GARbro/ArcFormats/AnimeGameSystem/AudioPCM.cs`, classes `PcmAudio` and `PcmInput` (GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/anime-game-system/pcm-audio.ts` (`agsPcmAudioDescriptor`,
`agsPcmAudioFormat`, id `ags-pcm-audio`).

A sound of the AnimeGameSystem engine: four bytes and then the samples as they stand. The first three bytes are
the letters `WAV` and the fourth is the **kind of sound**.

The reference's word is `0x564157` — the three letters and a byte of nothing — compared against the first four
bytes with `0xF0FFFFFF`, which is to say with the fourth byte's **high nibble** masked away and the rest of it
kept: a file whose fourth byte is ten or above is not this format, whichever kind it names.

## The kinds

| kind | rate | depth |
|---|---|---|
| `0x0A` | 44100 | 16 |
| `0x06` | 22050 | 16 |
| `0x04` | 22050 | 8 |

The **low bit** of the kind is not part of it: it says how many channels there are, one more than it carries, so
a kind of five is the kind of four with a second channel. The bit is taken off before the rate and the depth are
looked up, and put back into the channel count.

A kind the reference knows no rate for makes its reader **throw** rather than decline the file. GARbro's own
dispatch catches whatever a reader throws while the format is being found, keeps the error and moves on to the
next one, so such a file is no more this format's than one whose letters are another's — and the port declines it
the same way.

The sound behind the four bytes is wrapped in a wave container of the kind's own shape: the container's header is
computed from the rate, the depth and the channels, and the samples follow it as they stand.

The tests cover the three letters with a kind whose high nibble is set, a wave file under the same name and a
file of three bytes, a kind the reference knows no rate for, a sixteen bit sound wrapped in a container with
every field of its header, the two other kinds with their rates and depths, a kind whose low bit makes it stereo,
and a sound of no bytes at all.
