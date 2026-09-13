# Favorite View Point multi-frame image

## Reference and attribution

- GARBro reference: `ArcFormats/Favorite/ArcHZC.cs` (`HzcOpener`, `HzcArchive`) and
  `ArcFormats/Favorite/ImageHZC.cs` (`HzcFormat`, `HzcMetaData`)
- GARBro tag: `HZC/MULTI`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARbro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

An `hzc1` file is both an image and an archive of frames. The archive layer defers to the image
reader's metadata parser, so the port validates the same layout: the unpacked size sits at 4, the
metadata header size at 8, and the reader refuses the file unless `NVSG` appears at 0xC. The frame
count at 0x20 counts as one when it is zero.

Dividing the unpacked size by that count gives the frame size, and every frame becomes a directory
entry named `<image>#<n padded to 3>` whose offset is the frame index times the frame size. GARbro
performs no placement check at all here, because those offsets address the decompressed image rather
than the file; the port keeps the same virtual offsets and records the image fields, along with the
derived depth (`0` is 24-bit, above `2` is 8-bit, otherwise 32-bit), as entry metadata.

The payload behind the metadata header is a zlib stream. The reference inflates one frame at a time
until it reaches the frame the entry points at and returns that frame, which means only the requested
frame needs to be decompressed; the port streams the same way and stops early. A frame count that
leaves a zero-sized frame would make the reference loop forever, so the port refuses such a file
instead. The image decoder that turns frames into bitmaps is out of scope for the archive layer.

## Support

| Capability | Status |
| --- | --- |
| `hzc1` signature validation | Supported |
| Image metadata validation (`NVSG`, sizes) | Supported |
| Frame count with the zero default | Supported |
| Frame directory with padded names | Supported |
| Frame-size derivation and guard | Supported |
| Metadata exposure (depth, size, position) | Supported |
| Zlib frame extraction with early exit | Supported |
| Image decoding to bitmaps | Unsupported |
| Archive creation | Unsupported |

Synthetic fixtures cover frame splitting, the zero-count default, marker rejection, and the frame
size guard.
