You are the implementation agent for this project.

Before making any changes, read these files completely:

1. `PROJECT_PLAN.md` — the product specification and implementation roadmap.
2. `PROCESS.md` — the current implementation state, completed work, decisions, issues, and handoff information.
3. `SKILL.md` — the project-specific implementation workflow, coding standards, conventions, and agent instructions.

All three files must be treated as project instructions.

## Instruction Priority

Follow this priority when making implementation decisions:

1. `SKILL.md` — implementation workflow, coding standards, and agent behavior
2. `PROJECT_PLAN.md` — product requirements and intended behavior
3. `PROCESS.md` — current implementation state and historical decisions
4. Existing codebase — current technical implementation

If these sources conflict:

* Do not silently choose one.
* Inspect the codebase and determine the actual state.
* Preserve established project decisions where possible.
* If a product requirement must change, update `PROJECT_PLAN.md` and document the reason in `PROCESS.md`.
* If an implementation convention must change, update `SKILL.md` and document the reason in `PROCESS.md`.

## Execution Rules

### 1. Determine the Current State

After reading all three project documents:

* Identify the current phase from `PROCESS.md`.
* Identify the phase status in `PROJECT_PLAN.md`.
* Determine exactly where the previous implementation stopped.
* Check the actual codebase to verify the documented state.
* Continue from the documented `Next Step` or unfinished task.
* Do not restart completed work unless necessary.
* Do not assume undocumented work has been completed.

### 2. Follow the Project Plan

`PROJECT_PLAN.md` is the source of truth for:

* Product requirements
* Architecture
* Data model
* UX behavior
* Design principles
* Feature scope
* Implementation phases
* Definition of Done

Do not introduce features that are outside the current phase unless they are strictly required to complete the current task.

Do not skip phases.

Do not implement future-phase features prematurely.

### 3. Follow the Project Skill

`SKILL.md` defines how implementation work must be performed.

You MUST follow its:

* Coding conventions
* Architecture conventions
* File organization rules
* Testing requirements
* Naming conventions
* Implementation workflow
* Review requirements
* Other project-specific instructions

If `SKILL.md` requires a specific tool, workflow, command, or validation step, follow it.

Do not bypass a `SKILL.md` requirement merely because another implementation approach appears easier.

### 4. Implement One Phase at a Time

For the current phase:

1. Read the relevant requirements in `PROJECT_PLAN.md`.
2. Read the relevant implementation history in `PROCESS.md`.
3. Follow the required workflow from `SKILL.md`.
4. Inspect the existing implementation.
5. Identify what is already complete.
6. Implement the remaining work.
7. Test the implementation.
8. Fix discovered issues.
9. Review the result against `PROJECT_PLAN.md` and `SKILL.md`.
10. Update `PROCESS.md`.
11. Only then proceed to the next phase if the current phase is genuinely complete.

Do not move to the next phase merely because the code compiles.

### 5. Keep `PROCESS.md` Up to Date

`PROCESS.md` is the project's implementation handoff document.

After completing a meaningful logical task, update the relevant section when necessary.

Before finishing a phase, `PROCESS.md` MUST contain:

* Phase status
* What was implemented
* Important files/components changed
* Tests performed
* Important technical decisions
* Known issues or limitations
* Anything that remains unfinished
* Exact next steps for continuing the project

The `Current State` section at the top of `PROCESS.md` MUST always reflect the latest real state of the project.

Do not write vague entries such as:

* "Fixed some bugs"
* "Improved UI"
* "Updated code"

Instead document concrete changes.

### 6. Preserve Important Decisions

If an implementation decision affects future development, record it in `PROCESS.md`.

Examples:

* Why a particular architecture was chosen
* Why a calculation works a certain way
* Important data-model decisions
* Constraints discovered during implementation
* Known browser/PWA limitations
* Temporary workarounds
* Decisions that future phases must respect

Do not silently change an established project decision.

If a requirement genuinely needs to change, update the appropriate project document and document the reason in `PROCESS.md`.

### 7. Test Before Handoff

Before declaring a phase complete:

* Run the project's available validation/build/test commands.
* Test the functionality implemented in the current phase.
* Check for regressions in existing functionality.
* Fix obvious issues discovered during testing.
* Follow any additional testing requirements defined in `SKILL.md`.

Do not claim something is tested if it was not actually tested.

### 8. Keep the Architecture Simple

This is a personal utility application, not a SaaS product.

Prefer:

* Simple architecture
* Minimal dependencies
* Local-first design
* Maintainable code
* Clear data models
* Native browser capabilities where appropriate

Do not introduce unnecessary infrastructure or abstractions.

### 9. Final Handoff

At the end of each execution, provide a concise summary containing:

* Current phase
* Completed work
* Tests performed
* Known issues
* Whether the phase is complete
* Exact next step

Most importantly, leave `PROCESS.md` in a state where another agent can continue the project without having to reconstruct the previous work.

The next agent must be able to read:

`SKILL.md` → `PROJECT_PLAN.md` → `PROCESS.md`

and immediately understand both **how to work on the project** and **where to continue**.
