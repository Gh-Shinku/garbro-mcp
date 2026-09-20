# LZSS-compressed BMP image

Reference: `GARbro/ArcFormats/ImageEGN.cs`, classes `EgnFormat`, `EgnMetaData` and `EgnFormat.Reader`.
GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/unknown/egn-image.ts` (`egnImageDescriptor`, `egnImageFormat`, id
`egn-image`, `readEgnLayout`, `unpackEgn`).

The head carries the **inverse** of its first word. The word's fourth to sixth bits are the mode, of which
only nought is walked at all — the modes one, two and three are refused by the reader itself and the rest by
the head — and its lowest four are the flag that tells the two words of the walk apart. Where the seventh bit
is set the stream stands four bytes in and its size is the highest three bytes of the word, read **the other
way round**; otherwise the stream stands eight bytes in and its size is a word of its own behind it, the other
way round as well. A size of nothing and one past sixteen million bytes are refused.

`Reader.UnpackV0` is a walk of two kinds of step behind a bit. A set bit is a byte that stands itself; a clear
one is a word the other way round, whose highest bits count the bytes the step takes and whose lowest ones
count the places behind the walk they come from, both told apart by the flag's own two words of the reference's
shift table. A step may reach before the start of the picture, and the bytes before it stand as noughts, which
is what the reference leaves there.

The head of the walk is walked on its own first — only the bitmap's own head, of fifty four bytes — and the
measurements are read out of that, which is what the reference does when it hands the unfolded head to its own
bitmap reader. The whole stream is then unfolded and handed out as the bitmap it is.

Because the word the head carries is the inverse of its own, and because the picture is told apart by the
bitmap behind the stream, this format carries no signature at all: the reference tries it for every file, and
so does this port, after the formats that carry a signature of their own.

Deviations from the reference, in the message only: a stream that ends inside the walk, and a picture whose
reference throws `NotImplementedException`, so this is a read only format.

The tests cover the head of the long form, the mode, the size and the bitmap behind the stream it is turned
away for, the head of the short form with its size four bytes in, a walk of literals and of steps back, the
bitmap handed out as the bitmap it is, and a file that does not hold a picture.
