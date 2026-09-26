# Utage engine encrypted image

Reference: `GARbro/ArcFormats/Unity/Utage/ImageUTAGE.cs`, classes `UtageFormat`, `UtageMetaData` and
`UtageEncryptedStream`. GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/unity/utage-image.ts` (`utageImageDescriptor`, `utageImageFormat`, id
`unity-utage-image`, `readUtageLayout`, `decryptUtage`).

The engine keeps its pictures behind a key of its own, `InputOriginalKey`, and the reference carries it in the
format. Every byte is taken with the key byte that stands over it — the key repeated over the file — and is
**kept as it is when it is nothing or when it is the key byte itself**, and turned over with the key byte
otherwise. The rule is its own opposite, so the same pass both reads and writes the stream; the two bytes it
leaves alone are the two the plain stream cannot tell from the key, and the reference reads them back
unchanged.

The reference registers **two words**: the portrait of the signature of a PNG behind the key —
`0xC0 0x3E 0x3E 0x32`, which is the PNG signature taken with the first four bytes of the key — and the word of
nothing, which offers the format for **every** file that no other format claimed. A file carrying the first
word holds a **PNG**; every other file holds a **JPEG**, and a file that does not turn into one is not claimed.
The measurements are read from the header of that picture, which is where this port reads them too.

Both pictures are decoded here, as the reference decodes them: the reference reads the decrypted stream through
the reader of the graphic the key reveals, and this port reads it with the two readers of this project,
`packages/formats/src/shared/png-image.ts` and `packages/formats/src/shared/jpeg-image.ts`, and hands a bitmap
over. The JPEG reader follows the baseline sequential profile of ITU-T T.81 and its widening of a
twice-as-coarse chroma stands in the colour space of the stream where the platform decoder of the reference
does it inside its colour conversion, so the two pictures differ by a few places at the edge of a colour change.

The tests cover a byte of nothing and a byte of the key staying where they are, the signature of a PNG behind
the key, finding a picture behind the key beside one that carries no word of its own, declining a picture that
is not behind the key, what each picture says about itself, each picture decoded into a bitmap — a graphic
written here place by place, and a grey stream exactly as the Python imaging library decodes it — and refusing a
file that is not one.
