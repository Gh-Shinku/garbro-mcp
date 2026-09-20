# JAMES engine obfuscated bitmap

Reference: `GARbro/Legacy/James/ImageJMG.cs`, classes `JmgFormat`, `JmgMetaData` and the enum `Obfuscation`
(the pictures of Berserker's "Situation" and "Situation 2"). GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/james/jmg-image.ts` (`jamesJmgImageDescriptor`, `jamesJmgImageFormat`,
id `james-jmg-image`, `deobfuscateJmg`, `readJmgLayout`).

The reference registers the word of nothing, so the format is a candidate for every file, and what gates it is
the first word of the file: `D4 24` stands for `RotateWords` and `B2 42` for `ReverseBits`. Both are the word
`'BM'` in disguise — turned left by four bits in the first case, and with its sixteen bits turned around in
the second — so the picture behind either is a bitmap, which the port reads and writes out again with the
shared reader and writer, at the depth the bitmap itself holds.

`RotateWords` turns every word of the picture left by four bits, and `ReverseBits` turns the sixteen bits of
comes round after four turns rather than two, so the port has no encoder for either and the tests do the
turning round themselves. The reference deobfuscates only the first `0x40` bytes to take the measurements
from the bitmap header and the whole file when the picture itself is asked for, which means a file too short
to hold that much is turned away, since the reference would read past the end of what it holds.

The reference reads a whole word at the end of the picture even when only half of one stands there, which
throws; the port refuses such a picture instead (a documented deviation in the message only). The write path
of the reference throws `NotImplementedException`, so this is a read only format.

The tests cover the two words standing for the letters of a bitmap, both walks taking a picture back where the
obfuscation left it, the refusal of a picture that ends in the middle of a word, a picture found by the
obfuscated letters of its bitmap for both ways and a plain bitmap turned away, a picture too short to hold the
header of its bitmap, the measurements of the bitmap behind the obfuscation, the bitmap written out again, a
picture that ends in half a word and a bitmap the picture is too short to hold.
