# PTI image

Reference: `GARbro/ArcFormats/ImagePTI.cs`, class `PtiFormat` ("Custom BMP image")
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/misc/pti-image.ts` (`ptiImageDescriptor`, `ptiImageFormat`, id
`misc-pti-image`).

A bitmap with two bytes inserted after its fourteen byte file header, and the word in that gap zeroed:

| field | offset |
|---|---|
| `BM` | 0 |
| file header | 2 |
| zero word | 0x0E |
| device independent header, forty bytes | 0x10 |
| pixels | 0x38 |

## What the two reads do

`ReadHeader` reads sixteen bytes, checks `BM`, checks that the word at 0x0E is **zero** and then reads forty
more bytes **into the same buffer from offset 0x0E**. That second read is where the format's shape comes from:
the header it produces in memory is a coherent fifty four byte bitmap header, with the device independent
header two bytes earlier than it sits on disk.

`Read` does the same thing at full size, and the part that took me two attempts is that the **pixels move with
the header**. The second read asks for `length + 0x28` bytes from file offset 0x10 and writes them at buffer
offset 0x0E, so every byte after the header shifts down two — the pixels land at **0x36**, which is a bitmap's
own pixel offset, and the last two bytes of the buffer are left as they were allocated. My first version copied
the pixels separately at 0x38, which left a two byte hole at the start of the image data; the tests now pin the
shifted layout, and it is the reason a pti file's pixels end up correctly aligned in the output even though the
header is not where a bitmap keeps it.

Two consequences a test checks: the output is exactly as long as the stored file, and its size word names two
bytes **fewer** than the buffer holds, because the reference computes it as header plus pixels rather than as
the buffer length.

## The two bytes a short twenty four bit image is missing

```csharp
if (24 == info.BPP && length+2 == info.Width * info.Height * 3)
{
    image[image.Length-2] = 0xFF;
    image[image.Length-1] = 0xFF;
    length += 2;
}
```

The condition is about `width * height * 3`, not about any stride, and it fires when the stored pixel data is
exactly two bytes short of that figure. The marker is written over the **last two bytes of the buffer** — which,
given where the pixels landed, are the two bytes the read never filled — and the length goes up by two, which
makes the size word name the whole buffer. So every stored pixel survives and the buffer ends with `FF FF`; a
test checks all three facts, including that the assertion is about the buffer's end rather than the pixel data.

## No signature, no extension

`Signature` is zero and no extension is checked, so the forty byte probe is the only thing between this format
and every file on disk. It is a strong probe: `BM`, a zero word, a header size of exactly forty and non-zero
dimensions. A **plain bitmap is declined**, because its header starts where the zero word belongs — a test
asserts that directly, which is also how this format is told apart from every other bitmap reader in the
project.

## Notes

* Because `bfSize` is computed rather than copied, the output's size word can differ from the stored one; the
  port writes what the reference writes.
* The port parses the header by hand rather than through the shared bitmap reader, which refuses a header whose
  size field describes a whole file rather than the fifty four bytes in front of it.
* A file shorter than 0x38 bytes, a non-zero word at 0x0E, a header size other than forty, zero dimensions and
  a depth of zero or above thirty two are all declined.
* The pixels are copied, not decoded, so the output is byte-exact for whatever depth the file declares; the
  depth only decides the two byte marker rule.
* `Write` throws `NotImplementedException` in the reference, so encoding is out of scope.

## A process note

Two of the three test failures this port had were fixture-side, but the third was a **stale assertion**: an
earlier version of the fixup test asserted the body against `pixels.subarray (0, 8)`, and my edit replaced only
the lines around it, so the old expectation stayed and failed against a correct port. The same edit had to be
redone with the `edit` tool after a scripted replacement failed to match text that biome had rewrapped — the
second time that has happened in this project, and the reason the rule is to anchor on current text and verify
that a replacement landed.
