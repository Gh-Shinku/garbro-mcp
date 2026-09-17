# BELL-DA compressed WAVE audio

Reference: `GARbro/ArcFormats/BellDa/AudioPW.cs`, class `PwAudio`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/bellda/pw-audio.ts` (`bellDaPwAudioDescriptor`,
`bellDaPwAudioFormat`, id `bell-da-pw-audio`, `readPwLayout`, `decodePw`, `PCM_TABLE`).

The file begins with the word `PW10` where a wave file carries `RIFF`, and behind it come the two chunks the
reference walks: the format chunk tagged `fmt ` at `0x0C` with its own size at `0x10`, and the samples chunk
tagged `data` behind it, whose size stands four bytes behind its tag. The samples themselves follow the
samples chunk's header.

Every stored sample is **one byte**, which stands for a word of the table the reference carries — two hundred
and fifty six words that climb from `0x8000` to `0xFFFF`, step through none and then fall back to `0x7FFF` —
packed little endian. Because each stored byte becomes a whole word, the block of a channel is **twice** the
one the format chunk declares, every sample is sixteen bits wide, and the average of bytes a second is what
the reference's own `SetBPS` builds from the rate, the channels and the depth. A stream that stops before the
samples it declares leaves the rest of the sound at nothing, which is how a region behaves for the reference.

The port hands the sound out as a canonical forty four byte wave file, which is what the reference's own
`RawPcmInput` becomes, so an entry reports the real byte count rather than the stored one. The write path of
the reference is not implemented, so this is a read only format.

The tests cover the two chunks and the doubled block of a channel, the tag and the two chunk refusals and a
sound whose samples are not all there, the table turned into words at its three ends, the wave file handed
out with its samples, the measurements the port reports, and a file that is not a sound.
