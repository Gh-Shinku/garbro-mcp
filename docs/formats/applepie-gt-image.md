# Apple Pie image (GT)

Reference: `GARbro/Legacy/ApplePie/ImageGT.cs`, class `GtFormat` (GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/applepie/gt-image.ts` (`applePieGtImageDescriptor`,
`applePieGtImageFormat`, id `applepie-gt-image`).

An image of the Apple Pie engine. Sixteen bytes hold a marker of three bytes — `GT` and `0x10` — then a byte of
flags, the width and the height as words, and the offset the pixels begin at. Behind the header, where that
offset says, sits one of three kinds of image.

The reference registers four words, `0x0B105447`, `0x06105447`, `0x01105447` and **nothing at all**, which are the
same three bytes with the flags in the fourth, so the port asks for those three bytes and reads the flags out of
the file itself. The reference's zero makes it try every file as well; the marker is what its reader then asks
for, so the port's own detection is that marker.

## The three kinds

The flag byte decides, and the two readers decide in **different orders**:

| flags | described as | read as |
|---|---|---|
| bit `0x08` set | 32 bits | a run length packed image of thirty two bit pixels |
| otherwise, low two bits `01` | 8 bits | one byte a pixel, greyscale |
| otherwise | 24 bits | three bytes a pixel, blue, green and red |

A file carrying **both** the alpha bit and the low bits of the greyscale kind — flags `0x09` — is therefore
described as eight bits and read as thirty two, which the port reproduces: what it reports and what it hands over
disagree in exactly the same way.

The greyscale and colour kinds are read straight from the offset the header gives, as many pixels as the
measurements call for; a file that is shorter than that stops with an error rather than a short image, which is
what the reference's own reader does when it cannot fill its buffer. Both kinds are top down.

## The packed kind

The packed reader walks its input in **fragments of two words**: the first word counts pixels that are **skipped**
and never written, so they keep whatever the buffer had, and the second counts pixels written from the four bytes
a pixel behind it. The loop counts the pixels of a whole image and stops once they are spent, so:

* a fragment that overshoots keeps writing behind the image and past the end of its buffer, where the reference's
  framework refuses the count — the port raises an invalid archive error in the same place;
* a fragment that skips **backwards** would write behind the start of the buffer, which the reference's framework
  refuses as well, and the port refuses it the same way;
* a file that ends in the middle of a fragment stops with an error, because the reference reads its words without
  a check.

The tests cover the marker with a file under each of the reference's four words, a file of two bytes and a file
with no measurements, a twenty four bit image read from an offset past its header with the row padding a bitmap
takes, a greyscale image with the grey ramp of its palette, a packed image whose skipped pixels are left as the
buffer had them, a file with both flags described as eight bits and handed over as thirty two, and a fragment
whose run length is missing, a run longer than its image, a fragment that skips backwards and a plain image
shorter than it says it is.
