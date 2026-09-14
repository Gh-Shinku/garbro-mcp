# F&C Co. image (ACD)

Reference: `GARbro/ArcFormats/FC01/ImageACD.cs`, class `AcdFormat`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/fc01/acd-image.ts` (`fc01AcdImageDescriptor`, `fc01AcdImageFormat`,
id `fc01-acd-image`), with the bit decoder exported as `decodeAcd`.

An image behind the word `ACD ` (`0x20444341`, the trailing space included) with a header of `0x1C` bytes:

| field | offset |
|---|---|
| `ACD ` and the version `1.00` | 0, 4 |
| header size, which is also where the data starts | 8 |
| packed size, unpacked size | 0x0C, 0x10 |
| width, height | 0x14, 0x18 |

The version is compared as **all four** of its bytes and the header size may not be under `0x1C`; the reference
throws its own `NotSupportedException` for either, so the word is what finds the file and the version is what
fails when it is read — the port detects by the word alone for the same reason.

The pixels are two layers deep. First the library's `MrgLzssReader` unpacks exactly the **packed size** from the
header, which the port does with the shared F&C decoder; what comes out is not pixels but a **bit stream**:

* a **zero** bit is a black pixel;
* **two set** bits are a white one;
* a set bit followed by a **clear** one reads seven more bits as a number and scales it into a level, a number of
  zero being black as well.

The reader holds a byte with a **sentinel** bit in its lowest place: the top bit is handed out and the byte is
shifted left, and when the byte falls to zero the next one is loaded and the sentinel put back. That is how it
knows to take another byte every eighth read, and it is why a stream that has been read to its end fails on the
next read rather than quietly returning zeroes. The seven bits the last code reads are always exactly seven,
because the accumulating value cannot carry out of its eighth bit before the seventh shift whatever the bits are.

Details worth recording:

* the reference describes the image as **twenty four** bits and then builds a **grey** bitmap from its decoder;
  the port reports the same twenty four bits in the metadata while the bitmap it writes is eight bit grey, which
  the entry's own name says as well;
* the scale is a **thirty two bit** multiply by `0x28CCCCD` whose overflow wraps and whose top byte is taken, so
  the largest number the code can carry — a hundred and twenty seven — lands at **seventy** rather than at its
  own level, which a test pins down;
* `ImageData.Create` is called with no flip and no stride of its own, so the bitmap is **top down** with rows of
  exactly the width;
* a zero width, a zero height, a zero unpacked size and an offset under the header size are refused here, where
  the reference would build an empty bitmap or fail in its decoder;
* the format declares no extension, so the word is the only way in.

The tests cover the word and the find by word alone, the version, header size and offset failures, the
measurements and sizes, a black and a white pixel, the smallest scaled level with a zero and with the wrapping
largest one, a stream running over several control bytes, junk behind the packed stream, a stream that stops in
the middle of a pixel, and the entry name.
