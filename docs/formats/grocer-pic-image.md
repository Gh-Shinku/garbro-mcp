# Grocer image format

Reference: `GARbro/Legacy/Grocer/ImagePIC.cs`, classes `PicFormat` and `PicReader`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/grocer/pic-image.ts` (`grocerPicImageDescriptor`,
`grocerPicImageFormat`, id `grocer-pic-image`, `readPicLayout`, `readPicPalette`, `decodePic`), with the
bitmap writer of `packages/formats/src/shared/bmp.ts`.

The reference registers the word one — a single byte — and no name.

## The head

The first byte of the file is that word, and the word `Actor98` stands at `0x10`. The width of the picture
stands in the places of the bits at `0x53` — eight places for every byte — and its height stands at `0x55`; a
picture of more than six hundred and forty places of width is turned away. Sixteen colours stand from `0x21`,
three bytes apiece: the green of the colour first, then its red and its blue, every byte standing for a colour
of four places, which is thirty four places of a colour of eight bits.

## The walk of a row

A row of the picture is walked four planes at a time, and every step of the walk gives a byte, or a run of
bytes, of a plane of that row. The bytes of the planes of a row stand in a buffer, the row at hand from
`0x280` — eighty bytes for every plane — and the rows behind it below that, and a step of the walk may take
its bytes from elsewhere in that buffer:

| step | what it does |
| ---- | ------------ |
| a byte above nought and below six | names how many bytes stand there and takes them from elsewhere |
| 1 | a byte that stands for all of them |
| 2 | the plane of the rows two rows behind |
| 3 | the first plane of the row at hand |
| 4 | the plane behind the first of the row at hand |
| 5 | the plane behind that one |
| 6 | stands in front of the single byte it gives |
| any other byte | stands for a single byte of the plane |

The places of the four planes of a row then stand together in every colour of the picture — the first plane in
the lowest place of a colour and the fourth in the highest — and the bytes from `0x140` to the end of the
buffer shift down to its beginning, so that the walk of the next row finds the rows behind it there. What is
handed out is a bitmap of eight bits with the sixteen colours of the head.

## Deviations from the reference

- A file of fewer than eighty seven bytes, whose first byte is not one, or whose head does not carry the word
  `Actor98` is turned away; the reference would throw while reading its head.
- A step of the walk that would stand beyond the buffer of the walk is refused with a message, where the
  reference writes beyond its own array and throws.
- A step whose bytes do not stand in the file is refused with a message, where the reference reads beyond the
  file and throws.
- The reference writes its picture with the `Indexed8` shape of its own platform, which holds one byte for
  every place of the picture and sixteen colours; the port writes a bitmap of eight bits with the same
  colours, and the reference leaves the writing of a picture out.

## Tests

`tests/formats/grocer-pic-image.test.ts` covers the head and the marks and bounds it is turned away for, the
colours of the head, the gathering of the places of four planes, the steps of the walk that take their bytes
from the plane in front, from the first plane of the row at hand, from the row two rows behind and from a run
of one byte, a picture gathered into a bitmap, a file whose first byte is not that of the engine, and a walk
that runs out of the file. The vectors are worked out by hand: the plane bytes `0x80`, `0x40`, `0x20` and
`0x10` give the colours 1, 2, 4 and 8, and the three rows of the second vector give the colours 15; 0, 1 and
4; and 1.
