# Fixtures

The archives in `xp3/` are generated deterministically by
`scripts/generate-xp3-fixtures.mjs` and may be freely distributed with this project. Review both
`manifest.json` and the golden tests whenever the fixtures are regenerated.

Use `private/` for real game archives and GARbro reference output that must not be committed. The
directory is excluded by `.gitignore` except for `.gitkeep`.
