# Saiki obfuscated JPEG image

Reference: `GARbro/Legacy/Saiki/ImageJPX.cs`, classes `ObfuscatedImageFormat` and `JpxFormat`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License. The bitmap beside it shares the obfuscation and is
ported in the same module, `docs/formats/saiki-bmx-image.md`.

Implementation: `packages/formats/src/saiki/obfuscated-image.ts` (`saikiJpxImageDescriptor`,
`saikiJpxImageFormat`, id `saiki-jpx-image`, `decryptSaiki`, `readSaikiJpxLayout`).

The reference registers the word `0x38FF9300` beside the word of nothing, which is the four bytes `00 93 FF 38`
at the start of the file, and reads the first two of them itself. The picture behind them is obfuscated: the
first byte is turned about, the second is complemented and turned left once, and the two hundred bytes from the
third on are turned left by a shift that walks from one to six and starts over at one every so many bytes. How
many, and whether the second byte of the file or the first one says so, is decided by those same two bytes
themselves: the first byte of the header stands for the number of bytes in the first stretch, and the second
byte takes over after a stretch of more than four turns. The whole two hundred and two byte header stands in
front of the rest of the file, which is left as it is.

Once the obfuscation is off the picture is a JPEG, and the measurements of the port come from the frame of that
JPEG through the shared header reader. The picture itself is **handed out as the JPEG it is**, because the
project carries no JPEG decoder, exactly as the core JPEG format does; the bytes are the ones the reference
decodes and encodes again. The write path of the reference throws `NotImplementedException`, so this is a
read only format, and a file too short to hold its two letters or its header is turned away by the detection
rather than by an exception — a documented deviation in the message only, since the reference's .NET reader
throws where the port declines.

The tests cover the obfuscation turned round again over a payload that walks through every shift of the
schedule, a file too short to hold a header, the word the reference registers, a picture found by the two
letters of its obfuscated header, the measurements of the JPEG behind the obfuscation, the JPEG handed out once
the obfuscation is off, and the refusal of a picture whose obfuscation hides no JPEG.
