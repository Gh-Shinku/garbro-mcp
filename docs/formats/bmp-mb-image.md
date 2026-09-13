# Obfuscated bitmap (BMP/MB)

Reference: `GARbro/ArcFormats/ImageMB.cs`, class `MbImageFormat`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/mb/image.ts` (`mbImageDescriptor`, `mbImageFormat`, id
`bmp-mb-image`).

A bitmap whose **first two bytes are replaced by a two letter tag**. The reference accepts `MB`, `MC`,
`MK`, `CL` and `XX` in place of the `BM` marker; `OpenAsBitmap` then drops those two bytes and prepends
the real marker, so the reconstruction is length preserving and touches nothing else.

The port exposes the resource as a single entry:

* detection requires one of those five tags and then reads the reconstructed bitmap through the same
  checks GARbro's metadata reader applies — a `BM` marker (restored by construction), a DIB header of at
  least forty bytes, non-zero dimensions and a non-zero bit depth. A plain bitmap whose marker is intact
  and a tag the reference does not list are both declined, and both are tested;
* the entry is named after the source file with a `bmp` extension, covers the whole stored file and sets
  `sizeKnown: true`: only the two marker bytes differ between stored and extracted, so the listed size
  really is the extracted size;
* extraction restores the marker and emits the bitmap verbatim, which the test asserts for every accepted
  tag by comparing everything from the third byte onward;
* entry metadata carries `type: "image"` with the dimensions and bits per pixel, and the archive metadata
  records `image: "bmp"`, the tag that was replaced as `storedTag`, and the same dimensions.

Two notes for the reader:

* GARbro implements `Write` for this class, writing `MB` followed by the bitmap from offset 2. This port is
  extraction only, so `create` is false; the encoding side is not implemented;
* the bitmap field checks now live in a shared `readBmpMetaData` in `packages/formats/src/shared/bmp.ts`,
  which this port and its two siblings use. The older bitmap-reading ports (Mina MD, Eye CSF, YellowCap
  GGF) still carry their own copies of the same logic; folding them onto the shared reader is a follow-up
  for a separate, behaviour-neutral commit.

The two subclasses that derive from this class in GARbro — `NGW` (Brownie) and `GDF` (Mink) — are ported
separately, since they replace the five tag check with a single fixed tag.
