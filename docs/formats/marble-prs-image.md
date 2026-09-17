# Marble engine image format

Reference: `GARbro/ArcFormats/Marble/ImagePRS.cs`, classes `PrsFormat`, `PrsMetaData` and `Reader`. GARbro
commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/marble/prs-image.ts` (`marblePrsImageDescriptor`, `marblePrsImageFormat`,
id `marble-prs-image`, `readPrsLayout`, `unpackPrs`, `hasDummyAlpha`).

The reference declares no signature word, and the two letters `YB` at the start of the head are what tells the
picture apart. The third byte is a flag, the fourth is the depth, of which **three or four** bytes a pixel is
allowed, the packed size stands at four and the measurements at twelve and fourteen. The depth is reported as
eight bits a channel.

The walk begins at the sixteenth byte and is bounded by the packed size the head declares, so every byte it
reads counts against that size whatever it is. A control byte is read when the last of its eight bits has been
used, and its bits are taken from the **highest** down: a clear bit is a literal byte, a set bit a copy whose
own byte says which of three kinds it is:

| the byte behind the control | what it means |
| --- | --- |
| highest bit clear, two low bits below three | the count is those two bits plus two, the distance the rest plus one |
| highest bit clear, two low bits all set | the rest plus nine bytes stand in the stream themselves |
| highest bit set, bit six clear | the count is the low nibble of the word behind it plus three, the distance the rest of the word plus one |
| highest bit set, bit six set | the count stands in a table of its own — three more per step, then `0x400` and `0x1000` — read from the byte behind the word, and the distance is the word plus one |

A copy is written a byte at a time, so one whose distance is one repeats the byte before it. The reference
**clamps** a copy to what is left of the picture rather than refusing it, which this port does as well, while
a run of literals that reaches past the end is refused, where the reference's own array read would throw
(a documented deviation in the message only). A distance that reaches before the start of the picture is
refused, which the reference answers with an exception of its own.

When the flag's highest bit stands, every byte behind the first pixel is a differential step of the byte one
pixel before it, made across the whole picture rather than row by row. A picture of four bytes a pixel whose
alpha channel holds one value throughout — other than the greatest one — is reported as having no alpha
channel at all, which the reference does by handing it out as `Bgr32`; this port writes those pictures with
the fourth byte of every pixel cleared, since a bitmap's blue, green, red, alpha layout carries no such
channel. The write path of the reference throws `NotImplementedException`, so this is a read only format.

The tests cover the head the reference reads, the two letters and the depth, the measurements the port
reports, a stream of literals, a copy whose count and distance stand in its own word, a run of literals of the
third kind, a copy whose count stands in the table, the differential walk with and without its flag, a picture
whose alpha channel holds one value and one whose alpha channel is real, and a copy that reaches before the
start of the picture.
