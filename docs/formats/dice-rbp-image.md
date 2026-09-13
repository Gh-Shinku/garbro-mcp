# DiceSystem image (RBP)

Two depths in one format: a twenty four bit branch whose pixels are five bit channels with six bits of alpha, and a
thirty two bit branch that holds the bytes as they are. [000623][Marimo] Setsunai.

## Reference

| Element | Value |
| --- | --- |
| Tag | `RBP` |
| Class | `RbpFormat` (`Legacy/Dice/ImageRBP.cs`) |
| Signature | `RBP1` |
| Header | `0x14` bytes |
| Extensions | None declared |

## Header

| Offset | Size | Meaning |
| --- | --- | --- |
| `0x00` | 4 | `RBP1` |
| `0x04` | 4 | Depth word: `1` means twenty four bits, anything else thirty two |
| `0x08` | 4 | Width |
| `0x0C` | 4 | Height |
| `0x10` | 4 | Where the pixels begin, signed |

Nothing else is validated: the depth is a comparison against one, and a file whose offset points outside itself is
accepted by the probe and fails when its pixels are read, which is where the reference fails too.

## Decoding

Both branches produce `Bgra32` pixels with the width's own stride, handed over unflipped, so the bitmap is top down.

The **twenty four bit** branch reads one three byte word a pixel, little endian, and expands it with shifts: the low
byte becomes blue, the middle byte green and the high byte red, taking five bits each, and the six bits above them
become the alpha — scaled to a byte, which the reference then truncates with a byte cast. That cast is worth noting:
a word of `0xFFFFFF` gives an alpha of `0xFF * 0xFF / 0x3F`, which is `1032`, and its low byte is `8`. Only a stored
alpha of exactly `0x3F` reaches `255`. The tests pin the expansion word by word, including that one.

The **thirty two bit** branch copies the bytes and scales every fourth one the same way, except that a zero stays
zero. It reads as much as the file holds and leaves the rest of the pixels blank, while the twenty four bit branch
fails when its words run off the end of the file — the reference's `ReadInt24` throws there, so the asymmetry is
faithful rather than accidental.

## Process notes

`ReadInt24` is a misnomer in GARbro: `ToInt24` builds the word with shifts and never sign extends, so the three byte
words are always in `0 .. 0xFFFFFF`. The port's arithmetic depends on that.

The golden values in the tests were computed from the **word the bytes produce**, not from the bytes as they read on
the page: a fixture holding `0F 1E 3D` is the word `0x3D1E0F`, and its last channel expands to `0xF6` rather than
the `0x3C` the other order would give. That mistake cost a test run.
