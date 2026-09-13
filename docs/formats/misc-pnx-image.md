# Encrypted PNG image (Misc namespace)

Reference: `GARbro/ArcFormats/ImagePNX.cs`, class `PnxFormat` in `GameRes.Formats.Misc`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/misc/pnx-image.ts` (`pnxEncryptedImageDescriptor`,
`pnxEncryptedImageFormat`, id `misc-pnx-image`).

A **PNG stream XORed with a single byte key over the whole file**. Unlike the other obfuscated PNG ports
the transformation is a plain XOR, so no offset moves and the length is preserved. The signature is
`0x2F2638E1`, which is the PNG magic with its first byte already XORed: `0xE1` is `0x89 ^ 0x68`.

The key is not a free parameter. `PnxFormat.GuessEncryptionKey` returns `(byte)(Signature ^ 0x89)`, which
reads only the low byte of the signature and therefore always produces `0x68`. The port derives the key
from its own signature constant the same way, and the test asserts both halves of that relation by hand —
the encrypted fixture must start with the declared four bytes, and `0xE1 ^ 0x89` must equal `0x68` — so a
mistranscribed constant on either side fails the suite.

| field | offset in the **decrypted** stream |
|---|---|
| PNG signature | 0 |
| IHDR chunk length (13) | 8 |
| `IHDR` | 0x0C |
| width (u32 BE) | 0x10 |
| height (u32 BE) | 0x14 |
| bit depth | 0x18 |
| colour type | 0x19 |

The port exposes the resource as a single entry:

* detection matches the signature and then re-checks the **decrypted** header — PNG signature, an IHDR
  length of exactly 13, the `IHDR` tag, non-zero dimensions and a known colour type. GARbro gates this
  format through the registry and derives the key from the low signature byte alone, so re-checking the
  decrypted content is a deliberate deviation of the same kind as the other obfuscated PNG ports: it keeps
  a file that merely happens to match the four prefix bytes out of the format, and is tested;
* the smallest accepted file is 29 bytes, the signature plus chunk header plus the thirteen byte IHDR body,
  which is what the metadata reader actually consumes;
* the entry is named after the source file with a `png` extension, covers the whole file and is flagged
  `encrypted: true`. Because the XOR preserves the length, the entry sets `sizeKnown: true`: the listed
  size really is the extracted size;
* extraction XORs every byte back, yielding the original PNG byte for byte;
* entry metadata carries `type: "image"` with the dimensions and bits per pixel, and the archive metadata
  records `image: "png"`, `encrypted: true`, the bit depth, colour type, channel count and bits per pixel.

Do not confuse this with `zenos-pnx-image` (`Legacy/Zenos/ImagePNX.cs`, tag `PNX/ZENOS`): that format
replaces the first eight bytes of the file with the PNG header rather than XORing, and its stored signature
is `89 50 4E 58`.

Encoding and archive creation are out of scope.
