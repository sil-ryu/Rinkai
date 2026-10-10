# RINKAI (臨界)
Browser space-sim and mission-control game. Full spec: docs/SPEC.md. Read the current milestone's section before starting it.

## Commands (Windows; Python via uv)
- Frontend: `cd frontend && npm run dev | npm test | npm run lint`
- Backend: `cd backend && uv run uvicorn app.main:app --reload | uv run pytest | uv run ruff check .`

## Rules
- SI units internally; scale only at render time.
- Secrets live in .env only. Never commit or print them.
- Mission odds are game-tuned: always `tuned: true` with cited sources and a "game model, not a prediction" UI label.
- White holes are always labeled speculative.
- Every external API call goes through the backend proxy with cache and offline snapshot. Never call third parties from the frontend.
- Never invent endpoints or statistics; verify with data-source-checker and record in docs/data-sources.md.
- Agencies (NASA, CNSA, JAXA, ESA, ISRO, Roscosmos, CSA, commercial) get neutral, equal treatment.
- Delegate: test-runner for suites, physics-verifier after any formula change, data-source-checker before depending on an endpoint, code-reviewer before each milestone commit.
- Post a plan and wait for approval at the start of each milestone. One commit per milestone, only after /milestone-check passes.
