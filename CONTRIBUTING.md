# Contributing

## Pull requests

Use one ordinary pull request per change that a reviewer can accept or revert as a unit.
Start a topic branch from the latest `origin/main` and target `main` with the PR. Make a
commit whenever a logical step is complete and keep adding related commits to that branch.
For example, a HyPack extraction PR can contain a Cocotte decoder, its integration with the
archive reader, and format notes. An unrelated format fix belongs in its own PR.

Give the PR a Conventional Commit title describing the combined result, such as
`feat(hypack): extract Cocotte-compressed entries`. In the description, explain what a user
can do after the change and how you verified it. For a format port, identify the GARBro
reference and the fixtures or differential checks used.

Address review feedback on the same branch. Merge through the PR after review and CI pass.
Prefer a squash merge using the PR title as the commit subject. The PR
retains the individual commits for review. If their separate history is useful on `main`,
use a merge commit and check the individual commit messages for accurate release notes.

### Version PRs

Release Please collects releasable changes on `main` into a separate version PR. Leave
package version updates and changelog generation to that PR. The maintainer reviews its
version and release notes and decides when to publish. Merging an ordinary PR delivers the
change to `main`. Merging the version PR with publication enabled starts the release workflow.
See the [distribution guide](docs/distribution.md) for the release workflow.

## Commits

Use Conventional Commits with a meaningful scope when possible:

```text
<type>(<scope>): <description>
```

```text
feat(xp3): add archive index parsing
fix(lzss): preserve unsigned 32-bit overflow
test(afa): add extraction golden fixture
```

* Use lowercase types and scopes.
* Write concise, imperative subjects without a trailing period; avoid vague subjects such as
  `update`, `fix stuff`, or `wip`.
* Commit completed work promptly. Give each commit one explicit logical boundary and include only
  the files it requires; do not mix unrelated refactoring or other changes into it.
* Keep documentation, infrastructure, codecs, and individual format ports in separate commits
  unless they are inseparable parts of the same behavior.
* Before committing, inspect the staged diff and run checks appropriate to the changed scope so the
  commit remains reviewable.
* For a task with multiple logical changes, validate and commit each one before starting the next.
