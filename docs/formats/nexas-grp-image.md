# NeXAS engine image format

Reference: `GARbro/ArcFormats/Nexas/ImageGRP.cs`, classes `GrpFormat`, `GrpMetaData` and `GrpReader`. GARbro
commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/nexas/grp-image.ts` (`nexasGrpImageDescriptor`, `nexasGrpImageFormat`,
id `nexas-grp-image`, `readGrpLayout`, `unpackGrp`).

Every signature word the reference registers begins with the two letters `GR`, so the port matches those two
and reads the head. The third byte is the version, of which one to three is allowed, the fourth and fifth are
the depth, and behind them stand the width at five and the height at nine. A picture of the second version or
above declares its own unpacked size at thirteen; of the first version that size is the measurements at the
declared depth, with the colour map of an eight bit picture added behind them — seven hundred and sixty eight
bytes that stand **inside** the picture and are read from its end.

The depth decides both the pixels and the format they are handed out in: eight bits indexed with the colour
map, sixteen bits `Bgr555`, twenty four `Bgr24` and thirty two `Bgr32`. A depth the reader does not know is
refused; the reference's own reader throws when it is asked to unpack such a picture, so the port does not
offer one as this format either.

A picture of the first version stores its pixels as they stand from the thirteenth byte. Every later version
packs them apart from their control bits:

* the length of the control bits stands at `0x11` as a word, the control bytes behind it, one more word
  behind them, and then the literals and the copies they govern;
* the control bits are read from the **lowest** bit of every byte up; a clear bit is a literal byte, a set bit a
  copy;
* a copy reads a word that holds the distance and the count, the count in the low bits — **three** of them for
  the third version and **five** for the second — and the distance in the rest, one more than either says.

A copy is written a byte at a time, so one whose distance is one repeats the byte before it, and a copy that
reaches outside the picture is refused, which the reference's own array write answers with an exception as
well (a documented deviation in the message only). A control bit stream that runs out ends the walk, which is
what the reference's own bit reader does when it returns nothing; a stream that stops where a literal is
wanted is refused, where the reference's own reader would take a byte of nothing.

The tests cover the head of each version, the size the first version builds for itself, the version gate and
the depth the reader does not know, the measurements the port reports, a picture of the second and of the
third version unfolded through their own counts, a picture of the first version as it stands, the colour map
of an eight bit picture read from the end of its pixels and turned into the order a bitmap wants, the packed
walk, and the refusals of a copy that reaches outside the picture and of a stream that stops.
