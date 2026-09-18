# AbogadoPowers audio format

Reference: `GARbro/ArcFormats/Abogado/AudioADP.cs`, classes `AdpAudio` and `AdpDecoder`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/abogado/adp-audio.ts` (`abogadoAdpAudioDescriptor`,
`abogadoAdpAudioFormat`, id `abogado-adp-audio`, `readAbogadoAdpLayout`, `decodeAbogadoAdp`, `AbogadoAdpDecoder`).

The reference registers the words `0x5622`, `0xAC44` and nought, the last of which stands for **every** file,
so the head alone is what tells a sound from anything else: the sample rate stands at nought and has to be a
rate between eight thousand and ninety six thousand, the channel count at four and has to be one or two, the
count of samples at `0xBC` — **already counting every channel** — and the place of the stream at `0xC0`,
which may not stand at or past the end of the file. The port tries this format after the ones that carry a
signature of their own, which is the order the reference's own fallback gives it.

Every nibble of two that follow is one sample, the higher one first, so the stream is the count of samples
rounded up to two, in bytes. A sound of one channel decodes **both** nibbles with the same walk, so its own
state carries from one to the next; a sound of two channels gives the higher nibble to the first walk and the
lower to the second.

One step of the engine's own ADPCM takes the quantiser **before** it moves, moves it by the code's own step
of the increment table, and scales the quantiser by the low three bits of the code; the code's highest bit
says which way the step goes, and the sample is kept within a signed word. The quantiser itself is kept
within the table's bounds. The samples are handed out as a sixteen bit wave.

Deviations from the reference, in the message only: a place before the file is refused rather than left to
the stream, and a file too short to hold the stream the head declares is refused rather than failing part way
through. The reference's own write path throws `NotImplementedException`, so this is a read only format.

The tests cover the head and the fields it is turned away for, one step of the decoder, the wave of a sound
of one channel, the two independent walks of a sound of two channels, and a file that does not hold a sound.
