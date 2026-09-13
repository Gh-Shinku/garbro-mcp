# Mutation compressed image

Reference: `GARbro/Legacy/Mutation/ImageRBM.cs`, class `RbmFormat`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).
Implementation: `packages/formats/src/mutation/rbm-image.ts` (`rbmImageDescriptor`, `rbmImageFormat`, id
`mutation-rbm-image`).

| field | offset |
|---|---|
| marker `RBM` | 0 |
| width (`u16`) | 6 |
| height (`u16`) | 8 |
| compressed pixels | 0xA |

## No validation beyond the marker

`ReadMetaData` reads ten bytes and takes the two dimensions from them. There is no sanity check at all, so the
port has none either: a degenerate size is accepted here and fails later, if it fails at all. The signature
value has a zero high byte, which is how the reference's own dispatcher treats it — **three** bytes are
compared, and the fourth is not examined. A test writes a foreign value into that fourth byte and shows the file
is still recognised.

## The codec

A bit stream decides what each step is, and the bits are used from the **most significant end**: the mask is
shifted *before* it is tested, and the first test after loading a byte therefore uses 0x80.

| control bit | meaning |
|---|---|
| set | a match: one `u16` follows |
| clear | a literal: three bytes, one whole pixel, follow |

A match word is split twice, and **both** halves are counted in pixels before being scaled by three:

```
count  = ((word & 0xF) + 1) * 3     // one to sixteen pixels
offset = ((word >> 4) + 1) * 3      // three to 196608 bytes back
```

The copy may overlap its own output — a run — so it is done a byte at a time. Two guards come from what the
reference's array copy would do at the edges: a match whose source lies before the start of the image, and a
match that asks for more pixels than are left, both fail rather than silently wrap. A test covers each, and one
of them also asserts the exact control byte of a literal-then-match pair, which pins the bit order.

## Where the reference tolerates a short stream

The reference ignores what its literal read returned, so a stream that ends inside a pixel leaves the rest of
that pixel as allocated — zero — and the loop still ends if the image is then full. A test truncates the final
literal to two bytes and shows the third as zero. A missing control byte or a half-read match word is a
different matter: those are read with the stream's own readers, which throw, so extraction fails.

## Output

The stride the reference computes is `width * 3` — exactly three bytes a pixel, **tighter** than a bitmap's —
so the rows are repacked through the shared writer, which pads them to four byte alignment. `CreateFlipped`
means bottom up rows under a positive height, which the test asserts along with the padding of a three pixel
row.

`Write` throws `NotImplementedException` in the reference.

## Process notes

Three faults, all in the fixtures rather than the port:

* a match asked for sixteen pixels when only fifteen remained, which the port's overrun guard caught — a useful
  demonstration that the guard works, once the fixture was fixed;
* a fixture assertion expected a literal to set its control bit. It is the opposite: a literal is a **clear**
  bit, and the byte for one literal followed by one match is `0x40`, not `0xC0`;
* the expected pixel data was compared against the bitmap's data without its row padding, twice — a one pixel
  row is padded to four bytes and a two pixel row to eight.

When the numbers still did not add up, the fastest way was to make a throwaway test **throw** the actual
lengths and bytes it had produced, rather than reasoning about them again. The values confirmed the port and
localised all three problems to the test file.
