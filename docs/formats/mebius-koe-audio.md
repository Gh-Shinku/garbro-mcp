# Mebius engine encrypted wave file

Reference: `GARbro/ArcFormats/Mebius/AudioKOE.cs`, class `KoeAudio`, with the scrambling walk of
`ArcFormats/SimpleEncryption.cs`, class `ByteStringEncryptedStream`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/mebius/koe-audio.ts` (`mebiusKoeAudioDescriptor`,
`mebiusKoeAudioFormat`, id `mebius-koe-audio`, `mebiusKind`, `readKoeLayout`, `decryptKoe`).

The file is a plain wave file whose one stream the engine scrambled: the word `RIFF`, the shape `WAVE` and a
chunk of a format whose size stands at `0x10` all stand as they are, and the stream of the file is scrambled
from the place behind the head, the format chunk and the eight bytes of the header of the stream — the plain
bytes at the place the size of the format chunk gives.

What finds such a file is **the name it carries**, not the word at the beginning of it: every wave file begins
with `RIFF`, so the reference stands beside that word with a priority above the plain one and reads only the
three kinds of name the engine writes — `koe`, `mse` and `bgm` — which are also the three kinds it keeps a key
for. The keys are the ones of the reference's own scheme `Mebinya!`, two hundred and fifty six bytes each; the
scheme `Tomodachi Ijou Koibito Miman` of the same file belongs to other formats of the engine and is not read
here.

`ByteStringEncryptedStream` exclusive ores every byte of the stream with the byte of the key that stands as far
into the key as the byte stands into the stream, the key standing over and over. The scrambling is its own
inverse, so what the port hands out is the wave file the engine wrote before it scrambled the stream: the head
stands as it is and the stream is unscrambled.

Deviations from the reference, in the message only: a file whose head is not `RIFF` and `WAVE`, a format chunk
of a negative size, a stream that does not stand behind a chunk named `data` and a stream that does not stand
inside the file are refused, where the reference would hand the bytes to its own wave reader and let that
reader fail on them.

The tests cover the head, the kind taken from the name and the kinds without a key, the shape of the wave file
it is turned away for, the unscrambling of a whole wave file against the one that was scrambled, all three
kinds of file with their own keys and the difference between them, the finding of a file by its name, and a
file that does not hold a scrambled wave file.
