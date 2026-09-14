# SLG system encrypted JPEG image

Reference: `GARbro/ArcFormats/Slg/ImageTIG.cs`, class `TicFormat` — the sibling of the format's `TigFormat`,
over the same cipher. GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT.

Implementation: `packages/formats/src/slg/tic-image.ts` (`slgTicImageDescriptor`, `slgTicImageFormat`, id
`slg-tic-image`), which reuses `decryptTig` from the TIG port and a shared JPEG header reader,
`packages/formats/src/shared/jpeg.ts`.

A JPEG scrambled exactly as its PNG sibling is: every byte has the **low byte of one draw** of the Microsoft C
runtime's generator subtracted from it, from a seed of `0x7F7F7F7F` starting at the file's first byte. The
registered word `0x15A44A01` is the graphic's signature through that scramble, and the class inherits the
scramble from the format above it in the reference, which is why the port shares the one function.

The measurements come from the **decrypted** file through the shared reader, a port of the reference's
`JpegFormat.ReadMetaData`:

* it wants the two bytes of the start of image marker first;
* it then walks marker segments, ending the walk on a marker whose first byte is not `0xFF` and on a file that
  stops inside a marker, which is where the reference's stream would throw;
* a **frame** is any marker of `0xC0..0xCF` **apart from `0xC4`** — which is the reference's own test, so the
  Huffman table marker that shares the range is skipped, while `0xC8` and `0xCC` are taken as frames because the
  reference does not exclude them;
* a frame whose segment length is under eight bytes ends the walk, and its six header bytes — bits a sample, the
  height, the width and the component count — are read without looking at that length at all;
* the depth is reported as the frame's bits **times** its components, taken as the product comes, so a twelve
  bit three component frame is reported as thirty six;
* every other segment is skipped by its own length, which may land past the end of the file and end the walk.

Because the reference reads through a **seekable** decrypting stream and its graphic reader seeks across the
segments, the whole file is decrypted before the header is read here, and the entry returns the decrypted
graphic itself. It is reported as compressed for the same reason the PNG sibling is, and the format declares no
extension, so the word is the only way in.

The tests cover the registered word and the absent extension, the need for the cipher and the seed it starts
from, the depth of a colour, grey and unusually deep frame, a walk past an application segment and a Huffman
table marker, the decrypted output with the file's own bytes recovered by scrambling it again, four heads the
reader refuses, and the entry name.
