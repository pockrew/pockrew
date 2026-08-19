# Third-Party Notices

Pockrew is distributed under the Functional Source License 1.1 with an MIT future
license (see `LICENSE.md`). This file records every third-party work bundled with or
derived into Pockrew, and the license obligations that come with it.

Required by SPEC D1 (M0 deliverable) and SPEC A19.

## Asset license policy

Pockrew sells a closed-source Desktop Pro surface (SPEC A19). Every bundled asset must
therefore be usable in a commercial, closed-source product.

**Accepted:** MIT, CC0-1.0, Apache-2.0, or original work authored for this project.

**Rejected, no exceptions:** AGPL, GPL, CC-BY-SA, CC-BY-NC, "free for personal use",
"free with attribution in-app", or any license whose terms are unclear. SPEC F1 lists
"Asset license block commercial" as a live risk — the mitigation is refusing the asset
up front, not auditing it later.

Attribution-required licenses (CC-BY, Apache-2.0) are accepted but the attribution must
be recorded in this file _and_ reachable from the app's Setup & Health surface.

## Code

No third-party code is vendored into this repository yet.

If M0 decides to fork an MIT base (SPEC C1 evaluates Age of Agents and Pixel Agents),
its copyright notice and license text go here, and the fork decision goes in
`docs/data-notes.md`.

Runtime dependencies installed from npm are not vendored and are not listed here; their
licenses live in `pnpm-lock.yaml` and each package's own `node_modules` entry.

## Assets

No third-party assets are bundled yet. Characters and station art are M3 (SPEC D4).

Record each asset as it lands:

| Asset | Files | Source | License | Attribution required |
| ----- | ----- | ------ | ------- | -------------------- |
| —     | —     | —      | —       | —                    |

## Fonts

None bundled. The web UI uses the system font stack.
