# Uran image format

Reference: `GARbro/Legacy/Uran/ImageDAR.cs`, classes `DarFormat`, `DarMetaData` and `DarReader`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License.

Implementation: `packages/formats/src/uran/dar-image.ts` (`uranDarImageDescriptor`, `uranDarImageFormat`, id
`uran-dar-image`, `readDarLayout`, `unpackDar`).

The file is signed `DAR:`, and the two bytes behind it are `8` and a version, of which one or nothing is read,
with a count of frames at six that must be at least one. The frame head stands at `0x40C`:

* of the nothing version the head is always eight bytes and the depth always eight bits;
* otherwise a head size of its own stands at `0x40C`, and the head behind it carries the width, the height,
  the size of a row and a word the reference passes over. A head of fourteen bytes or more carries three more
  words behind them (a word the reference passes over, another word, and the height again), and one of sixteen
  or more a table: its count stands at fourteen, and the depth at the count behind it — provided eighteen
  bytes of the head and the count fit inside the head size.

The rows themselves stand a head size behind the frame head, and are a step of the row size apart. A picture
of eight bits carries a colour map of two hundred and fifty six four byte entries behind its head, at `0x0C`;
the entries stand blue, green, red and nothing, which is already the order a bitmap wants.

A row is a run: a **signed** word says how far into the row the run begins and a word behind it how many bytes
it holds, of which a count of nothing means the row holds nothing at all. The rows are written **bottom up**,
the first row of the stream becoming the last row of the picture, which is how a bitmap of its own stores
them. A run that reaches outside the picture is refused, which the reference's own array write answers with an
exception (a documented deviation in the message only).

The write path of the reference throws `NotImplementedException`, so this is a read only format.

The tests cover the head of each version, the two marker bytes, the version and the count of frames and a
depth the reader does not know, the runs of the rows placed bottom up, a run at an offset inside its own row,
a run that reaches outside the picture, and a file that does not hold a picture.
