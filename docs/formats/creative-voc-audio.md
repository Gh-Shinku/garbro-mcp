# Creative Voice File

Reference: `GARbro/ArcFormats/AudioVOC.cs`, classes `VocAudio` and `VocReader`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/creative/voc-audio.ts` (`creativeVocAudioDescriptor`,
`creativeVocAudioFormat`, id `creative-voc-audio`, `convertVoc`).

The file begins with the mark `Creative Voice File` and a NUL of its own; the size of its head stands at
`0x14` as a word and may not be smaller than the head, and the blocks stand behind it. The block walk runs
until a kind of nought, and every block is a kind, a size of three bytes and then its own body:

| kind | what the block holds |
| --- | --- |
| `1` | one channel of eight bit sound, with its frequency and its codec behind the head |
| `2` | more of the sound the block before it began — the only kind that copies without a format |
| `8` | the **format** of a sound of one or two channels: its frequency, its codec and its channel count |
| `9` | the sound of any depth, with its rate, its depth, its channel count and its codec, four bytes that are not read, and then its samples |

Every other kind is passed over by its size alone. The depth and the tag of the wave come from the last codec
a block named: nought is a plain wave, four is a wave of sixteen bits, and seven is a wave of its own
(`0x07`, µ-law) whose samples stand as they are. The rate of the two eight bit kinds is worked out of their
own frequency byte or word — a million over two hundred and fifty six less the byte, and two hundred and
fifty six million over the channel count times sixty five thousand five hundred and thirty six less the word
— and the two averages are the rate times the frame of a block.

Worth naming: the reference reads the format of a block of kind eight and then copies **nothing at all**, so
such a block contributes no samples and the walk goes on with whatever stands behind the four bytes it read.
The port keeps that behaviour, and the tests show both halves of it.

Deviations from the reference, in the message only: a head smaller than the head, a block that reaches past
the file or ends inside its own head, and a codec other than the three the reference knows are refused, where
the reference would throw format exceptions of its own. The write path of the reference throws
`NotImplementedException`, so this is a read only format.

The tests cover the rate of the first kind, the mark, the head size and the samples it is turned away for,
the ninth kind with its own rate and depth, the eighth kind and its missing samples, a block that continues
the one before it, the µ-law codec, a block of a kind the reader does not know, the wave written out, and a
file that does not hold a sound.
