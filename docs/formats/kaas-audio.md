# KAAS engine audio format

Reference: `GARbro/ArcFormats/Kaas/AudioKAAS.cs`, class `KaasAudio` with its own sample table. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/kaas/kaas-audio.ts` (`kaasAudioDescriptor`, `kaasAudioFormat`, id
`kaas-audio`, `readKaasLayout`, `decodeKaas`).

The reference registers no signature at all — its only extension is the empty one — so the head alone tells a
sound of this engine from anything else, and the port tries this format after the ones that carry a signature
of their own: the count of samples stands at nought as a word, the word `0x800` at four, the channel count at
six — of which nought and one are read, standing for one and two channels — the sample rate at eight, and the
word `0x84BE2329` at twelve. The file has to hold **exactly** the bytes the count declares behind its own
head, which is the check that makes the format safe to try on everything.

Every byte of the stream behind the head is an index of the table of two hundred and fifty six words the
reference carries — a table that climbs from nought to its largest step over its first half and falls from
minus one to its smallest over its second — and the samples are handed out as a sixteen bit wave.

Deviations from the reference, in the message only: a channel count beyond one and a count that does not
agree with the file's own length are refused, where the reference simply returns nothing. The write path of
the reference throws `NotImplementedException`, so this is a read only format.

The tests cover the head of one and of two channels, the fields it is turned away for, the words the table
hands out for the first, the last and the turning bytes, the wave written out, and a file that does not hold
a sound.
