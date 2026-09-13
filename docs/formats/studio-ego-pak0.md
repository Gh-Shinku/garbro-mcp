# Studio e.go! resource archives (PAK0/EGO)

## Reference and attribution

- GARBro reference: `ArcFormats/StudioEgo/ArcPAK0.cs`, classes `Pak0Opener` and `Pak0Reader`
- GARBro tag: `PAK0/EGO`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

The archive stores a small tree of directories and files behind the signature `PAK0`. Directory records carry a
parent index instead of a path, so the reader rebuilds every path by walking the parent chain upwards.

## Layout

```
[u32 'PAK0'] [u32 data offset] [i32 directory count] [i32 file count]
[i32 parent] [i32 last index]          (per directory)
[u32 offset] [u32 size]                (per file)
[u8 length] [name]                     (directory names, then file names)
[payloads]
```

The data offset must be larger than 0x14 and smaller than the file, and both counts must be sane. Directory
records are checked while they are read: a parent index that is out of range or that points at the record itself
rejects the archive. A directory whose parent is minus one is a root and stores no name, which is why only the
remaining directories read a name from the name area.

Names are read straight from the file, one length byte followed by that many shift-jis bytes, first for every
directory that has a parent and then for the files, in directory order. A file's index decides how many files
belong to a directory: the reader walks a running counter up to each directory's last index, so the file records
and the file names are consumed in directory order.

## Paths

A path is built by walking from the directory upwards, collecting names until a root is reached, reversing the
list and joining it. A root directory therefore yields an empty prefix and its files are listed under their plain
names. The reference uses backslashes because it runs on Windows; the port joins with a forward slash and
normalizes the result, so the listing is identical on every platform.

## Script payloads

A payload longer than 0x1C bytes that starts with `SCR ` is a script:

```
[u8 'SCR '] [u32 version] [u32 method] [u32 key] [i32 length] [body]
```

The body is decrypted in place with a key schedule over thirty-two bit words. The reference declares a version
that must not be zero and a method of one or two, and only decrypts `length / 4` words from offset 0x14 onwards.
Every 256 words the key is either toggled between zero and one (method one) or complemented (method two), then
the constant `0x7654321` is added and the word is xored with the key. Every other payload is handed out as it is
stored.

## Port notes and deviations

- The reference computes the script body length from a signed word and then walks an unsafe pointer over the
  payload, so a length that reaches past the payload reads neighbouring memory. The port truncates the body to
  the payload instead and leaves the untouched tail as it was stored.
- Entries are not checked against the file size when the index is read; the reference does not check them either,
  matching the archive's own reader. A record that points outside the file fails when it is opened.
- GARbro does not write this format, so archive creation stays out of scope.

## References

- `GARbro/ArcFormats/StudioEgo/ArcPAK0.cs` - `Pak0Opener`, `Pak0Reader`, `DecryptScript`
