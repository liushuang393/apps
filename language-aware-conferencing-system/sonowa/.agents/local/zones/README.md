<!-- sr-managed -->
# Zone rules

One file per zone declared in `project.md` section 8. This directory ships empty on purpose.

A zone file narrows the project's rules for one region of the repository — the coding
standard a particular vendor or subsystem follows, the checks that region must pass, the
constraints that apply only there. Name it after the zone id: `shared.md`, `product-a.md`.

Zone rules can add constraints. They cannot remove one that `.agents/core/common/contract.md`
or `project.md` section 5 imposes — see `.agents/core/common/zones.md`.

A repository with one uniform standard needs no zones and no files here.
