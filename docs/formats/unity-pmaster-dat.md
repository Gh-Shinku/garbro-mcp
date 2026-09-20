# Unity PMaster engine resource archive

Reference: `GARbro/ArcFormats/Unity/PMaster/ArcDAT.cs`, classes `DatOpener` and `PMasterEntry`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/unity/pmaster-dat.ts` (`unityPMasterDatDescriptor`,
`unityPMasterDatFormat`, id `unity-pmaster-dat`, `readPMasterLayout`, `generatePMasterKey`,
`decryptPMasterPlaces`, `encryptPMasterPlaces`), with the fixed entry helpers of
`packages/formats/src/shared/fixed-archive.ts`.

The reference registers no word of its own and no name at all.

## The head

How many files the archive holds stands as the places of the head of the file counted as four and thirty places
of their own apiece, the head standing in the first four hundred places of the file, so that a place of the head
that holds more places than the file holds files names more files than the archive can hold. Two places of the
head name where the walks of the file stand from: the place at `0x5C` where the walk of the names stands from
and the place at `0xD4` where the walk of the files stands from.

## The walk of the files

The walk of the files stands behind the head, four and twenty places apiece for every file: where the name of
the file stands in the walk of the names, where the places of the file stand, how many places they hold, and the
key they stand under. The walk of the names stands behind the walk of the files and holds the names of the files
one behind the other, every name standing as a text of the unit kind that stands at nought.

## The walks of the keys

Every walk of a file of this kind stands under a key of its own, which stands from one place of the head: the
walk of the files, the walk of the names, and every file of the archive. The key stands as a walk of two
hundred and fifty six places of its own, every place of it standing from the place before it by a walk of four
and thirty places: five places down, standing beside the place that stood before it, four hundred and seventy
one times over, less the place the head named, beside that place again, and with the places beside the place
behind it standing at nought.

## The walk of the places

Every place of a walk of places stands under the place of the key of its own that stands at the same place of
the key, four and forty places of the key standing beside it, and under the places the reference names for every
place of such a walk: the place stands under its own place of the key, four and seventy places stand beside it,
the place of the key four and forty places on stands beside that, its own place of the key stands back out of
it, and the places beside four and thirty stand over it. The walk does not stand as its own other way.

## Deviations from the reference

- A file of fewer than four hundred places, a file whose head names no file or as many as this project stands
  as mad, a file whose walk of the files does not stand whole in it, a name that does not stand as the name of a
  file, and a file that stands outside the archive are turned away; the reference would throw while reading its
  head, or would hand out a walk it read under the wrong key.
- The walk of the files stands between the head and the walk of the names, so how many places the walk of the
  names holds stands as where the places of the first file stand less the places of the head and of the walk of
  the files, which is what the reference stands it as.

## Tests

`tests/formats/unity-pmaster-dat.test.ts` covers the walk of a key of its own, the places a walk of places
stands under and the walk standing them back, the walk of the files and the walk of their names, a file whose
head names no file at all, a file whose walk of the files stands outside it, the files of an archive stood in
the clear, and the finding of an archive of its own kind. The archive of the test stands worked out with a walk
of the key of its own, which stands the places of the walk the other way of the one the reference stands, so
its places stand under a walk this port did not work out.
