# Unity engine scenario archive

Reference: `GARbro/ArcFormats/Unity/ArcDSM.cs`, class `DsmOpener`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/unity/dsm-archive.ts` (`unityDsmArchiveDescriptor`,
`unityDsmArchiveFormat`, id `unity-dsm-archive`, `hasDsmByteOrderMark`, `dsmClearSize`), which stands over the
walk of `packages/formats/src/unity/dsm-script.ts`.

The reference names the same file twice: once as an archive, which this port is, and once as a script of its
own, which `unity-dsm-script` is. Both hand out the same places in the clear, so this port stands over the
same walk of the key the reference knows.

## The front of such a file

with. Where they do, the file holds one file of the name `data.txt`, which stands as a script of its own, and
whose places stand from the front of the file to its end.

clear; the reference names it the same way.

## Deviations from the reference

- A file whose name does not stand as the name of such a file, and a file whose places do not begin with the
  places a text of the kind stands with, are turned away; the reference leaves such a file to the kinds that
  read it otherwise.
- How many places the file the archive holds stands in is named the way the reference names it, which stands
  whole.
- The reference stands before the kind that reads the same file as a script of its own only where the file
  file of the same name apart by those places alone.

## Tests

`tests/formats/unity-dsm-archive.test.ts` covers the places a text of the kind stands with, how many places
the clear holds, a file read as an archive of its own kind, a file of the same name whose places do not begin
with those places, which stands as a script of its own, and the places the archive hands out. The scenario of
the test stands under a key another walk of the standard kind stood and under the cipher of the command line,
so it does not stand under a key this port stood itself.
