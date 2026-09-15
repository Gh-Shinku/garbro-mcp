# GsPack image format

Reference: `GARbro/ArcFormats/GsPack/ImageGS.cs`, classes `PicFormat` and `PicMetaData`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/gs-pack/pic-image.ts` (`gsPackPicImageDescriptor`,
`gsPackPicImageFormat`, id `gs-pack-pic-image`, `readPicLayout`, `picBodyLength`, `unfoldPic`).

The reference registers the word `0x00040000` — the bytes `00 00 04 00` — and declares the **made-up**
extension `pic`. Behind the signature stand, each as a thirty two bit word, the length of the stream, the
length of what it unfolds to, and the length of the header, which must leave something of the file behind it;
the stream standing at the end of the header must fit inside the file as well. Behind those comes a word the
reference skips, the width, the height and the depth, and — in a header that reaches forty four bytes — the
place of the picture as three more words: one that says whether a thirty two bit picture carries the
transparency of its pixels, and the two offsets.

The stream at the end of the header is unfolded with the **settings the reference leaves alone** — a frame of
`0x1000` bytes, filled with nothing, whose position begins at `0xFEE` — and taken as:

* **eight bits a pixel**, with a colour map of `0x400` bytes in front of the pixels, which the port copies
  verbatim into the bitmap;
* **sixteen bits a pixel**, five bits of red, six of green and five of blue;
* **twenty four bits a pixel**;
* **thirty two bits a pixel**, whose fourth byte is kept as it stands. The reference looks at that byte, and
  where it is not nothing anywhere it names the picture `Bgra32` and where it is nothing everywhere it names
  it `Bgr32`; both carry the same bytes, so the port writes them the same way and says nothing about the
  difference.

Any other depth is one the reference takes for a thirty two bit picture while reading one byte for every eight
bits it names, which is a picture of neither kind; the port **claims** such a file the way the reference's
metadata does and refuses it when the picture is asked for (`UNSUPPORTED_FEATURE`, a documented deviation for
a depth the reference garbles). A stream that does not reach the colour map is refused; one that does not
reach the pixels is not — the reference reads into a buffer of its own and leaves the rest at nothing, which
the port mirrors. The picture is held to 256 MB.

The tests cover the signature, declining a header whose lengths do not fit the file, the measurements and the
place of the picture, a picture of three bytes a pixel, the colour map of a picture of one byte a pixel, a
stream too short to reach every pixel, five and six bit channels, four bytes a pixel handed out as they stand,
and a depth the reference garbles.
