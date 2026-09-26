# rUGP engine resource archive (`RIO`)

Format reference: GARbro `ArcFormats/rUGP/ArcRIO.cs` (`RioOpener`, `RioReader`, `CRioArchive`, `CObject` and
the objects of the engine), with the bit stream of `ArcFormats/BitStream.cs` behind the names of its classes
and the char maps of the same file. GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

## What an archive of this engine carries

There is no table of entries. An archive carries a **graph of objects** — a root, a list of nodes behind it,
and the objects of those nodes — and the places of the pictures and the sounds of a game are the places of the
nodes of that graph. The classes the opener names are:

| class | kind |
| --- | --- |
| `CRip`, `CRip007` | image |
| `CS5i`, `CIcon` | image |
| `CRsa`, `CVmFunc` | script |
| `CWaveAudio`, `CrelicHicompAudio` | audio |

## The two kinds of archive

| kind | head | graph |
| --- | --- | --- |
| the archive itself | the mark `0x596E32CD` at the head of the file | the places of the file |
| an archive of no mark | an `.ici` payload beside it | the index the payload names |

An `.ici` payload stands of a key of its own: two counts that hold each other, then a place by place walk of a
key that turns a turn of its own, a checksum of sixteen places behind every run of thirty two places, and
three column walks with two accumulators behind them. Behind that payload stands a **manifest** of the game:
the version of it, the strings of its release, and the records of the archives it ships. The record of the
archive the payload was read of names the index of the game (`TocOffset`, `TocSize`), and the graph of the
archive stands of the places of that index, of the mark of an encrypted archive at the head of it.

The reference asks for the payload first as the name of the file with `.ici` behind it and then as the name of
the file of the archive with `.ici` behind it (the extension of the file turned into `.ici`).

## The walk of the graph

The head of a graph is the mark of the engine, the schema of the walk (`0x10` to `0x3FFF`, of a count of
sixteen places of flags behind the count of the mark of the archive), and the class of the root — written in
the stream itself where the tag of it reads `0xFFFF`, and named of the count of the classes of the archive
otherwise. The list of the classes behind the root stands of a count and then of a node a place:

* a node of a graph that does **not** stand encrypted stands of its name in the stream (`CreateOceanEntry2`),
  and the node of a graph that does stand of no name at all.
* the flags of a node name the class of it (of the stream, of a basic type of the engine, or of the count of
  the classes), and the places of it stand of two counts of thirty two places behind them.
* a place of the graph whose places do not stand of it stands of the place of a node read before, of the map
  of the engine.

The places of a node of the second kind of archive stand of the count of the places of the head of the walk
(`m_shift`), and the places of the **entries** of the listing stand of the count read out of the node alone,
without that count. Both the reference and this port hand an entry the place of its node; an archive whose
index stands of such a count is therefore listed with the places of its graph rather than of its file.

## Deviations

* Three places of the reference stand as `NotImplementedException` and stand as a refusal here as well: the
  message classes of a type (`ReadMsgClass`, `GetRtcFromMessageName`), the anonymous references of the graph
  (`CreateAnonymousRio`), and the map a class list that does not stand encrypted asks for a node of a name it
  read (`FindObject`). The last of them is **unreachable** rather than unported: the walk of such a list
  stands a node of every name it reads, so it never asks the map for one.
* The class of the object a node stands for is taken from the **name** of the node (`ReadObject`), which only
  the nodes a reference of an encrypted graph made carry the name of a class: the nodes of the list of the
  classes carry the name `unrefix`. The port holds that as the reference writes it.
* The archive is detected of the mark of the engine, of the `.ici` payload beside a file of no mark, or of the
  extension `rio`; a graph that does not stand behind either of the two is named as an archive of this engine
  and refused where the entries of it are asked for (`UNSUPPORTED_FEATURE`), rather than standing undetected.

## Tests

`tests/formats/rugp-rio-archive.test.ts` builds an archive of the first kind: the mark of the engine, a graph
of two nodes of the classes the engine knows (a picture of the class `CS5i` and a sound of the class
`CWaveAudio`), the manifest of the game behind them (of the version and the strings of its release), and the
places of the two objects behind the graph. The listing of the archive, the places of the two objects and the
places of them within the file are held to the fixture, the kind of every class stands beside them, and a file
that carries neither the mark nor an `.ici` payload is not an archive of this engine at all.

The walks of the graph itself stand in `packages/formats/src/rugp/rio-core.ts` (the marks, the schemas, the
tags of the classes, the tree of a scrambled class name, and the payload of an `.ici` file) and
`packages/formats/src/rugp/rio-objects.ts` (the objects of the engine and the walks of the graph), of tests of
their own: `tests/formats/rugp-rio-core.test.ts` and `tests/formats/rugp-rio-objects.test.ts`.
