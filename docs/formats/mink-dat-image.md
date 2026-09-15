# Mink compressed bitmap

Reference: `GARbro/Legacy/Mink/ImageDAT.cs`, classes `DatFormat` and `MinkMetaData`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/mink/dat-image.ts` (`minkDatImageDescriptor`, `minkDatImageFormat`,
id `mink-dat-image`, `readDatLayout`, `unpackMink`).

The reference registers this format under no word at all, so every file is offered to it and the shape of the
stream itself is what decides. A stream opens with a marker byte of `3`, the length of everything behind it —
the two counts of bits included — and the length the picture unfolds to; the two lengths have to agree with
what follows them, and nothing else of the picture is checked here.

Behind them sit two bytes saying of how many bits the two parts of a run are made, and then a stream of bits
read from the highest one down:

* a bit of **ones** is a byte of the picture behind it;
* a bit of **nothing** is a run, which carries the place it starts at and the count it holds, of as many bits
  as the two bytes at the head of the stream say. The place is counted from the **start of the picture**
  rather than from where the writing has come to — the same stream the Triangle and Scoop engines use counts
  backwards — and the run is one longer than the count it carries, shortened where it would reach past the
  picture.

A stream that ends leaves the rest of the picture as it was, which is where the zeroes of a short stream come
from. A run that reaches outside the picture is refused with `INVALID_ARCHIVE`, where the reference's own copy
would throw, as is a picture that unfolds to something other than a bitmap, and one that unfolds to more than
256 MB with `LIMIT_EXCEEDED`.

The picture is a **bitmap** in full, header and all, so the width, the height and the depth come from a
bitmap reader. The reference unfolds the first 56 bytes of the stream once to read the header off them, and
that is what the port does as well, which is why a stream holding less than a bitmap header is not one this
format claims.

The tests cover finding a stream whose lengths agree with what follows them and declining one whose marker or
packed length does not, the length the picture unfolds to being read but not checked, a stream that does not
unfold to a bitmap, what the bitmap says about itself, a picture written a byte at a time, a run repeating
what the picture already holds, the zeroes a stream that stops early leaves behind, a run reaching outside the
picture, and a picture shorter than the bitmap it unfolds to.
