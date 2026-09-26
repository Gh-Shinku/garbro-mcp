# Unity asset archive (`UNITY/FS`)

Format reference: GARbro `ArcFormats/Unity/ArcUnityFS.cs` (`UnityFSOpener`, `BundleSegment`, `BundleEntry`,
`AssetEntry`, `AssetDeserializer`) over `ArcFormats/Unity/BundleStream.cs`, `ArcFormats/Unity/Asset.cs`
(`Asset`, `UnityObject`, `TypeTree`, `UnityTypeData`), `ArcFormats/Unity/AssetReader.cs` and the type name
table `ArcFormats/Unity/strings.dat`, GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

## The head of the file

| place | field |
| --- | --- |
| 0 | the word `UnityFS` behind a place of no name |
| 8 | the count of the head of the kind (`i32`, of the places of the other way of the engine), of the kind six alone |
| 0xc | the count of the engine (`utf8`) and the count of the walk of it (`utf8`), every one of them behind a place of no name |
| — | the count of the places of the file (`i64`), the count of the index of it as it stands (`i32`), the count of the index of it (`i32`), and the flags of the file (`i32`) |

The low six places of the flags name the walk of the index: nothing (the index stands as it stands), the
walk of the blocks of the format (`codecs/lz4.ts`) and the walk of the LZMA kind. The highest place of the
flags names the index standing at the **end** of the file rather than at the head of it, of the streams of
the places of the file in front of it.

## The index

| place | field |
| --- | --- |
| 0 | sixteen places the reference stands over |
| 0x10 | the count of the streams of the file (`i32`) |
| — | for a stream: the count of the places of it (`u32`), the count of the places of it as they stand (`u32`) and the walk of it (`u16`) |
| — | the count of the bundles (`i32`) |
| — | for a bundle: the places of it within the streams (`i64`), the count of the places of it (`i64`), the flags of it (`u32`) and the name of it (`utf8`, of a place of no name behind it) |

Every count and every place of the index stands of the **other way of the engine**. The walk of a stream is
of the same kinds as the walk of the index. The places of the streams stand of each other, one behind the
other, of the places of the file of every stream behind the places of the stream in front of it.

## The bundles

Every bundle of the archive stands of a serialized asset of the engine (`asset-file.ts`): the places of the
head of it, the table of the kinds of the places of the walk of it (`TypeTree`, of the walk of a name in
front of the places of it for the kinds ten and twelve and up, and of a run of the places of the walk itself
for the kinds behind them) and the table of the objects of it. The name of an object of the table of the
bundles of the asset stands of it where the asset carries one (the kind `AssetBundle`), and of the places of
the walk of the object itself (the first place of the kind `string` named `m_Name`) where it does not.

| kind of an object | the walk of it |
| --- | --- |
| `AssetBundle` | the names of the objects of the asset alone, of no place of the file of the asset at all |
| `TextAsset` | the places of the script of the object: the places of it behind the count of them, of a walk of the count of the places of the format where the flags of the kind of it name one |
| `Texture2D` | the places of the object itself; the walk of the places of a picture of the engine stands of no walk of this project |
| `AudioClip` | the reference reads the places of a sound of the engine of a walk of its own, of a table of the places of the sound of it: this port stands of no object of that kind at all |
| every other kind | the places of the object itself, of the kind of it as the name of it |

## Deviations

* The places of an object of the engine stand of the places of the **stream** of the file of the archive
  rather than of the places of the bundle of it: the reference names the places of an object within the
  stream of its own bundle, which stands of the places of the file behind the first bundle where the file
  holds more than one.
* A stream, and an index, standing of the **LZMA** walk stands refused (`UNSUPPORTED_FEATURE`), where the
  reference reaches a library of its own for it; a stream standing of a walk of no name stands refused as
  well, as the reference refuses it.
* An object of the kind `AudioClip` stands of no place of the walk at all, where the reference stands of it
  where the sound of it stands in a stream of the file and turns it away where it does not.
* The names of the kinds of the walk of a newer asset stand of the file of the reference
  (`ArcFormats/Unity/strings.dat`, of a place of the walk of a name behind the places of the file itself),
  which this port carries as the run of the places of that file. A place of a name standing past the places
  of the file stands of no name at all.
* The whole of the streams of the file stand of one buffer rather than of a walk over the places of the
  file block by block, which is what a walk of the places of a stream of the reference does; the places of a
  stream that stands short of the file stand refused rather than read past it.

## Tests

`tests/formats/unity-fs.test.ts` builds an archive of the kind six of one stream and one bundle, of a
serialized asset of the kind eleven of one `TextAsset` of one script: the head of the file stands pinned
(the counts of the engine, the places of the index at the head of the file and behind the places of the file),
the walk of the index stands pinned (the streams and the bundles over them), the walk of the asset of the
bundle stands pinned (the count of the kind, the table of the kinds of it and the object of it) and the
places of the script of the object stand handed over. An index standing of the walk of the blocks of the
format stands beside it, and a word of another kind, a file that stands short of a head and a file of no
index of its own stand turned away.
