# MyHarvest image (UNH)

Sixteen bit pixels under a small header, stored as a word stream: literals and overlapping copies, flagged one bit
at a time. [021206][MyHarvest] Idol Mahjong Final Romance 4.

## Reference

| Element | Value |
| --- | --- |
| Tag | `UNH` |
| Class | `UnhFormat` (`Legacy/Harvest/ImageUNH.cs`) |
| Signature | `UNH0` |
| Extensions | None declared |

GARbro baseline `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License: an independent TypeScript rewrite based on
GARbro behavior.

## Header

| Offset | Size | Meaning |
| --- | --- | --- |
| `0x00` | 4 | `UNH0` |
| `0x04` | 4 | Version, which must be one |
| `0x10` | 4 | Width |
| `0x14` | 4 | Height |

The pixel stream begins at `0x44` and every image is sixteen bits. A version word other than one is refused, which
is the whole probe besides the signature.

## The word stream

One control byte carries eight flags, **least significant bit first**: a clear bit means the next word is a literal
and a set bit means it is a copy. Each token takes two bytes:

```text
literal: the word itself
copy:    offset = word >> 4        count = (word & 0xF) + 2
```

Copies read from a four thousand and ninety six word window that the reference keeps beside its output, writing
every word it produces into both and moving both positions together. The window is therefore always the last page
of what has been written, and because a copy writes as it reads, a copy whose offset is just behind its own
position repeats the word it has just produced: a three word copy of one literal yields four of them, which the
tests pin down. The port reads its matches straight out of the output for that reason, starting from the same
blank page the reference's array starts from.

Two failures behave differently and the port keeps them apart:

* a missing **control byte** ends the stream, leaving the rest of the image blank — the reference breaks out of its
  loop there;
* a missing **word** throws, because the reference's own reader fails when its two bytes are not there.

A copy that would run past the end of the image throws as well: the reference writes past its array in that case.

## Output

The words are handed over unflipped in five six five order, so the port asks the shared bitmap writer for the five
six five masks rather than its own five five five default, and the bitmap's red mask starts at bit eleven.
