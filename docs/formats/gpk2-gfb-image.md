# GPK2 image format

Reference: `GARbro/ArcFormats/Gpk2/ImageGFB.cs`, classes `GfbFormat` and `GfbMetaData`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/gpk2/gfb-image.ts` (`gpk2GfbImageDescriptor`, `gpk2GfbImageFormat`, id
`gpk2-gfb-image`, `readGfbLayout`, `readGfbPalette`, `unpackGfb`).

The file begins with the word `GFB `. The width and the height stand at `0x1C` and `0x20` as words, the depth
at `0x26` as a word, the packed and the unpacked sizes at `0x0C` and `0x10`, and the offset of the stream at
`0x14`. Only eight, sixteen, twenty four and thirty two bits a pixel have a layout. The row of the reader's
buffer is the unpacked size shared between the rows, so it may be wider than the picture.

An eight bit picture whose stream does not begin right behind the head carries a palette there, of up to
`0x400` bytes. The entry size is a two hundred and fifty sixth of what the palette holds and the blue, green
and red bytes are taken as they stand, so a tight palette of three bytes an entry and a padded one of four
both read.

Where the head declares a packed size the pixels are unfolded with the engine's own LZSS (GARbro's
`LzssStream`, shared with the sibling ports through `@garbro-mcp/codecs`); otherwise they stand as they are.
The depth then chooses the layout: thirty two bits a pixel (the reference writes a `Bgra32` or a `Bgr32`
depending on whether any fourth byte is set, which is the same bytes either way), twenty four, sixteen as
`Bgr565`, and eight with its palette or, when it has none, as a grey picture. The rows of the reader's buffer
are taken out into the tight rows a bitmap wants, and the picture is handed out with its rows **bottom up**,
which is what `ImageData.CreateFlipped` means. The write path of the reference throws
`NotImplementedException`, so this is a read only format.

reference would read past the palette it holds (a documented deviation).

The tests cover the head, the signature and the head fields the reader turns away, a tight palette read and
spread again, a stream of the engine's LZSS, and the twenty four, thirty two, sixteen and eight bit pictures
written out again.
