# ANIM encrypted image

Reference: `GARbro/ArcFormats/Crowd/ImageGAX.cs`, classes `GaxFormat` and `GaxTransform`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/crowd/gax-image.ts` (`crowdGaxImageDescriptor`, `crowdGaxImageFormat`, id
`crowd-gax-image`, `decryptGax`, `stepGaxKey`, `readGaxLayout`).

The file begins with the signature word `0x01000000` — three clear bytes and a one — then sixteen bytes of key,
and the picture stands from the twentieth byte on. The reference turns that picture over and reads it through
its own portable network graphic reader, so the measurements and the depth are that reader's, and the port
gives the turned over bytes out as a portable network graphic without decoding and writing it again, as the
other ports that carry one do.

The transform works on whole blocks of sixteen bytes:

* every byte of a block is turned over by the key as it stands;
* after a whole block the key steps on, driven by the **byte before the last one** the block was turned over
  to, of which the three low bits name the step;
* what stands behind the last whole block is turned over by the key as it then stands, from its first byte on,
  and does not step it on again.

The steps of the key are the seven the reference writes out side by side, of which the sixth runs the seventh's
own step behind its own — the reference reaches it with a `goto case 7` — so the sixth and the seventh are not
the same step. Every sum is held to eight bits. The tests name each of the seven steps with the key the first
sixteen numbers build, which pins the order of the reads and the writes inside a step as well.

Detection needs the signature, the key and a picture that is a portable network graphic once it is turned
over; a file whose head is not all there is refused as well. A picture whose pixels would take more than 256
megabytes is refused rather than allocated. The write path of the reference throws `NotImplementedException`,
so this is a read only format.

The tests cover the signature and a picture that is not turned over into a portable network graphic, the
measurements the reference's own reader reports, the measurements and the encryption the entry carries, the
picture handed out as it stood before it was turned over, the transform of pictures of many lengths, each of
the seven key steps, and a file that is not all there.
