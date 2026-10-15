## What

<!-- One concern per PR. What changes for a person running the GUI, in a sentence or two. -->

## Why

<!-- The problem, or a link to the issue. -->

## Proof

<!-- How you checked it: the tests you added or ran, a screenshot or recording for anything visual (desktop and phone if the layout changed). -->

## Checklist

- [ ] Every commit is signed off (`git commit -s`): the [DCO](../DCO) is the only paperwork.
- [ ] `npm run typecheck && npm run lint && npm test` pass; `npm run test:e2e` for a UI change.
- [ ] New source files start with `// SPDX-License-Identifier: Apache-2.0`.
- [ ] No secret, real address, hostname or home path in code, fixtures or screenshots (screenshots come from `--demo`).
- [ ] A change to `shared/*` names the wire-contract change in the description.
- [ ] A line under *Unreleased* in `CHANGELOG.md` if a person would notice.
