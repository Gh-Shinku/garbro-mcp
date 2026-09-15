# YU-RIS compressed image format

Reference: `GARbro/ArcFormats/YuRis/ImageYCG.cs`, classes `YcgFormat`, `YcgMetaData` and `YcgReader`. GARbro
commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/yu-ris/ycg-image.ts` (`yuRisYcgImageDescriptor`, `yuRisYcgImageFormat`,
id `yu-ris-ycg-image`, `readYcgLayout`, `ycgPixelLength`, `unpackYcg`).

The reference registers `'YCG\0'` and declares no extension. A header of fifty six bytes stands behind the
signature: the width, the height, the depth, the method the picture is packed with, and then two pairs of
lengths — how much each of two streams unfolds to, and, for the first of them, how long it is packed, which is
where the second stream begins. The depth is only carried along: every picture of this format is unfolded into
four bytes a pixel of blue, green, red and transparency, and so is handed out as a thirty two bit bitmap with
its rows the right way up, because the reference builds it with `ImageData.Create`.

The method is unfolded as follows:

* **one**, two zlib streams. The first stands at the end of the header and is read into the picture from its
  first byte, and the reference asks it for **exactly** as much as its length promises, leaving anything the
  stream holds behind that unread; the second stands where the packed length of the first says it does, and its
  bytes are read where the first one left off, which is not necessarily the end of the picture — what neither
  stream reaches stays at nothing. Each stream must hold as much as its length promises, and the two together
  must have room in the picture, which the port checks before it unfolds anything (the reference lets the .NET
  array take care of the second, a documented deviation in the message only);
* **two**, which the reference throws a `NotImplementedException` for — the port **declines the extraction**
  with `UNSUPPORTED_FEATURE` rather than claiming to read it;
* anything else, which the reference throws an `InvalidFormatException` for and the port refuses as well.

The second packed length is read but never used, as in the reference. The picture is held to 256 MB.

The tests cover the signature, the measurements and the method of the header, the two streams unfolded into one
picture, a picture the streams do not fill, the filler the packed length of the first stream steps over, a
stream that holds more than its length promises, a picture with no room for both streams, each stream cut short
of its promise, a stream that is no stream, and the two methods that are not unfolded.
