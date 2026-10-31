# Wieloagentowy pipeline SDLC

Specyfikacja pipeline'u, w którym wyspecjalizowani agenci AI przejmują GitHub Issue oznaczone przez człowieka, implementują zmianę, recenzują ją w pętli i wdrażają na środowisko dev. Finalna akceptacja i merge zostają w rękach człowieka.

## Zawartość

- [intent.md](intent.md): intencja, czyli problem, oczekiwany rezultat, ograniczenia i pytania otwarte.
- [spec.md](spec.md): specyfikacja, czyli przebieg i maszyna stanów, agenci, bramki, bezpieczeństwo, hooki, konfiguracja repozytorium, ewaluacje, porównanie frameworków, metryki i rollout.
- [plan.md](plan.md): plan techniczny MVP, czyli decyzje przy warunku zera kosztów, architektura, ochrona tokenu subskrypcji, przyrosty P0–P8, fazy po MVP i śledzenie wymagań.
- [config/org-baseline.yml](config/org-baseline.yml): bazowy zestaw organizacji, czyli najłagodniejsze dopuszczalne wartości `.sdlc-agents.yml`, które repozytorium może tylko zaostrzyć (FR-10.2), oraz lista hostów sieciowych, której repozytorium nie zmienia.
- [prompts](prompts): prompty ról i [roles.yml](prompts/roles.yml) z modelem i promptem każdej roli, wersjonowane razem (FR-5.8).

## Najważniejsze założenia

- **Pięciu agentów z osobnymi uprawnieniami:** Orchestrator, Planner, Developer, Reviewer i DevOps. Każdy działa we własnej sesji, z własną listą narzędzi i własnym tokenem.
- **Pętla review:** Reviewer sprawdza cały diff, a Developer poprawia znaleziska, maksymalnie przez 3 rundy. Dopiero zatwierdzona zmiana trafia na dev i do finalnej akceptacji człowieka.
- **Kontrola zakresu:** PR zawiera tylko to, czego wymaga issue. Dodatkowe zmiany są znaleziskami blokującymi, a problemy zauważone po drodze trafiają do osobnych issue.
- **Hooki zamiast próśb w promptach:** zasady bezpieczeństwa i jakości są wymuszane w kodzie, na poziomie wywołań narzędzi agenta, gita i zdarzeń GitHuba.
- **Człowiek w pętli:** akceptacja planu zmian high-impact, merge i wszystko poza środowiskiem dev należą do człowieka.
- **Ewaluacje:** zestaw offline z podłożonymi defektami i testami bezpieczeństwa jest bramką dla każdej zmiany promptów, modeli i konfiguracji.
- **Metryki:** wskaźniki wyprzedzające i opóźnione, w tym metryki DORA, porównywane z linią bazową procesu prowadzonego wyłącznie przez ludzi.

## Status

Szkic. Pytania otwarte są w [sekcji 16.2 specyfikacji](spec.md#162-pytania-otwarte).

## Rozwój

Wymagania:

- Node.js 22 (wersja w [.nvmrc](.nvmrc));
- git 2.31 lub nowszy (wymaga go lefthook);
- [gitleaks](https://github.com/gitleaks/gitleaks) 8.30.1 w `PATH`, np. `winget install --id Gitleaks.Gitleaks --version 8.30.1`. Bez niego hook `pre-commit` odrzuca każdy commit.

`npm ci` instaluje zależności i hooki gita ([lefthook.yml](lefthook.yml)):

- `pre-commit`: Prettier, ESLint i gitleaks na plikach w stage'u;
- `commit-msg`: commitlint, czyli Conventional Commits z odwołaniem do issue w nagłówku albo w stopce, np. `feat: add the run store (#3)` albo stopka `Refs #3`.

Te same sprawdzenia uruchamia CI ([ci.yml](.github/workflows/ci.yml)), bo lokalne hooki da się obejść.

Skrypty:

- `npm run typecheck`: TypeScript bez emisji plików;
- `npm run lint`: ESLint z progami złożoności i rozmiaru;
- `npm run format` i `npm run format:check`: Prettier (bez plików Markdown);
- `npm run duplication`: jscpd z progiem 3%;
- `npm test`: Vitest;
- `npm run validate-config -- <ścieżka>`: walidacja `.sdlc-agents.yml` schematem i bazowym zestawem organizacji. Kod wyjścia 0 oznacza poprawną konfigurację, 1 niepoprawną, a 2 błąd użycia lub odczytu. Ścieżka jest względna wobec katalogu tego repozytorium. Skrypt uruchamia TypeScript bez kroku budowania, przez usuwanie typów w Node 22, więc kod pipeline'u nie używa składni, która wymaga transpilacji (`erasableSyntaxOnly` w `tsconfig.json`).
- `npm run prepare-session -- --role <rola> --workspace <katalog> --config <.sdlc-agents.yml> --out <katalog>`: zapisuje kontekst hooków i ustawienia Claude Code dla sesji agenta (rozdz. 3.4 planu). Katalog wyjściowy musi leżeć poza przestrzenią roboczą. Sesja powinna mieć `CLAUDE_CONFIG_DIR` w tym samym katalogu, a nie w katalogu domowym. Kody wyjścia jak w `validate-config`.
- `npm run session-summary -- --result <wynik.json> --audit <log.jsonl>`: podsumowanie sesji w Markdown bez transkryptu, z redakcją sekretów.
- `npm run orchestrator -- <polecenie>`: kod jobów reusable workflows Orchestratora (`filter`, `scopes`, `decide`, `role`, `advance`, `target`, `cancel`, `wait-run`, `finalize`). Tokeny, zdarzenie i ścieżki czyta ze zmiennych środowiskowych GitHub Actions, a wyniki zapisuje jako outputy joba.
- `npm run scope-gate`: bramka zakresu (QG-7.9) dla zdarzenia `pull_request` z GitHub Actions. Kod wyjścia 0 oznacza bramkę zaliczoną albo zdarzenie, którego nie dotyczy, 1 niezaliczoną, a 2 błąd.

## Hooki agentów

Hooki z rozdz. 9.2 specyfikacji są w [src/hooks](src/hooks). Claude Code uruchamia je poleceniem `node --experimental-strip-types src/hooks/cli.ts <zdarzenie> --context <hook-context.json>`, a zdarzenie podaje na wejściu standardowym.

- `PreToolUse`: każda reguła to osobna polityka w [src/hooks/policies](src/hooks/policies). Blokada kończy hook kodem 2 i trafia do logu audytowego z kategorią z M-E01. Hook nigdy nie odpowiada „allow”, więc reguły uprawnień Claude Code nadal działają.
- `PostToolUse`: redakcja sekretów w wyniku narzędzia, formatter i linter na zapisanym pliku, log audytowy wywołań w JSONL.
- `PostToolUseFailure`: log audytowy wywołań, które się nie powiodły.
- `Stop`: Developer nie kończy pracy, dopóki nie przechodzą `commands.lint` i `commands.test`. Decyzja trafia do logu audytowego, a podsumowanie sesji liczy ją osobno.
- Każdy błąd, niepoprawne wejście albo przekroczenie czasu blokuje akcję albo wstrzymuje wynik narzędzia. Proces, który nie wystartuje, blokuje akcję dzięki ustawieniu `onFailure: "block"`.

Polecenia projektu (formatter, linter, testy) hooki uruchamiają w [bubblewrap](https://github.com/containers/bubblewrap) bez sieci, bez widoku innych procesów i z zapisem tylko w przestrzeni roboczej, bo te polecenia wykonują kod zmieniany przez agenta (rozdz. 3.4 planu). Testy tej izolacji działają tylko na Linuksie z `bwrap`. Lokalnie są pomijane, a w CI (`REQUIRE_SANDBOX=1`) nie mogą być pominięte.

Analiza poleceń powłoki to heurystyka: nie widzi zawartości uruchamianych skryptów ani nazw plików powstałych z rozwinięcia wzorców. Drugą warstwą jest sandbox Claude Code (SEC-9.0c).

Próbną sesję na runnerze uruchamia reusable workflow [agent-trial.yml](.github/workflows/agent-trial.yml), wywoływany z ręcznego workflow na `main` repozytorium demo.

## Orchestrator

Przebieg sterują dwa reusable workflows wywoływane z cienkich workflow repozytorium demo (rozdz. 3.5 planu):

- [orchestrate.yml](.github/workflows/orchestrate.yml): job `filter` odrzuca zdarzenia botów i obcych, `decide` w grupie `concurrency` per issue liczy przejście maszyny stanów, a potem działają najwyżej dwie pary job roli i `advance`. Job roli wykonuje skutki uboczne tokenem roli, a `advance` zapisuje stan.
- [terminate.yml](.github/workflows/terminate.yml): zatrzymanie etykietą `agent:stop` i zakończenie po zamknięciu lub merge'u PR. Job `cancel` poza grupą anuluje run przebiegu, a `finalize` zapisuje stan końcowy, zdejmuje etykiety, kończy `agent-review` i publikuje podsumowanie zatrzymania.

W trakcie sesji roli job co 15 s sprawdza etykiety issue i PR oraz stan PR i po `agent:stop` albo zamknięciu PR przerywa sesję, bo GitHub dostarcza anulowanie do działającego kroku z opóźnieniem ok. minuty.

Stan przebiegu jest w ukrytym komentarzu GitHub App w issue ([src/core/run-store](src/core/run-store)), a przejścia w [src/core/state-machine](src/core/state-machine). Każdy job zapisuje log zdarzeń w JSONL i wgrywa go jako artefakt `run-events-<job>-<próba>`.

Ręczne uruchomienie workflow Orchestrate z numerem issue startuje przebieg czekający w kolejce, gdy nie ma innego aktywnego przebiegu, odbiera wynik bramek, który nie dotarł, a etap, którego job zakończył się bez wyniku, kieruje do `needs-human`.

Reviewer jest do P7 zaślepką ([src/agents/stub-role.ts](src/agents/stub-role.ts)) i nie zużywa limitu planu Pro. Jego zachowanie, a w testach także zachowanie Plannera i Developera, ustala ukryty blok w treści issue, np.:

```text
<!-- sdlc-stub
plans: [high-impact, normal]      # rodzaj planu w kolejnych wersjach
plan_update: high-impact          # pierwszy etap Developera aktualizuje plan
verdicts: [changes_requested, approve]
repeat_finding: true              # każde changes_requested zgłasza to samo znalezisko
failures:
  planner: [infra, usage-limit]   # nieudane próby etapu: infra, usage-limit, max-turns
delay_seconds:
  developer: 120                  # długa sesja, np. do testu zatrzymania
cost_usd: 0.01                    # szacunek kosztu każdej sesji
-->
```

Bez bloku Reviewer zwraca `approve`. Ostatni element listy obowiązuje dla kolejnych wystąpień. Pola `plans` i `plan_update` oraz wpisy `planner` i `developer` w `failures` i `delay_seconds` działają tylko w testach, bo w repozytorium demo Planner i Developer pracują na Claude Code.

## Planner

Planner działa w jobie roli jako sesja `claude -p` ([src/agents/claude-runner.ts](src/agents/claude-runner.ts)) z modelem i promptem z [prompts/roles.yml](prompts/roles.yml), narzędziami tylko do odczytu, limitem tur z kopii `.sdlc-agents.yml` przebiegu i hookami z [src/hooks](src/hooks). Prompt trafia na wejście standardowe, a plan wraca jako wynik ustrukturyzowany według schematu z [src/agents/planner/plan.ts](src/agents/planner/plan.ts) (`--json-schema`). Proces `claude` dostaje token Claude, ale żadnego tokenu GitHub ani Actions (rozdz. 3.2 planu).

Kod joba przed sesją zbiera dane dla Plannera: issue, komentarze osób z prawem zapisu, wcześniejsze wersje planu, podsumowanie zatrzymania poprzedniego przebiegu i diff brancha jego otwartego PR (FR-4.28b). Wszystko to trafia do promptu jako niezaufane dane (SEC-8.5).

Po sesji kod joba waliduje plan, klasyfikuje go i publikuje jako nowy komentarz z numerem wersji (FR-4.3, FR-4.6). Zmiana jest high-impact, gdy wskaże ją Planner albo któraś reguła z [src/agents/planner/high-impact.ts](src/agents/planner/high-impact.ts): manifest zależności, pliki CI, infrastruktury i konfiguracji bramek z `.sdlc-agents.yml`, `high_impact.extra_paths` albo limity plików i linii. Przed publikacją wersji high-impact job zdejmuje `plan:approved` (FR-4.5). Lista plików jest w bloku ` ```yaml sdlc-plan `, który czyta `parsePlanBlock`.

## Developer

Developer działa w jobie roli jako sesja `claude -p` z modelem i promptem z [prompts/roles.yml](prompts/roles.yml), narzędziami do odczytu, edycji i poleceń powłoki w sandboxie oraz hookami z [src/hooks](src/hooks). Sandbox nie pozwala poleceniom zapisywać w kodzie pipeline'u, w katalogu sesji ani w `$RUNNER_TEMP`, które leżą obok przestrzeni roboczej w katalogu domowym runnera. Sesja nie commituje i nie pushuje: zostawia zmiany w przestrzeni roboczej i zwraca według schematu z [src/agents/developer/work.ts](src/agents/developer/work.ts) typ i temat commita, podsumowanie, issue spoza zakresu i opcjonalną aktualizację planu.

Przed sesją kod joba przenosi `.git` checkoutu do własnego katalogu w `$RUNNER_TEMP` ([src/git](src/git)), a sesji zostawia kopię. Polecenia git joba działają na tym katalogu bez konfiguracji systemowej, globalnej i hooków, więc nic, co zapisała sesja, nie uruchamia się w jobie z tokenami. Job przełącza przestrzeń roboczą na branch przebiegu, a w pierwszym etapie przebiegu, który kontynuuje otwarty PR, scala do niego `main` i zostawia konflikty sesji (FR-4.28b). Potem instaluje zależności poleceniem `commands.install` w bubblewrap z siecią, ale bez tokenów joba i bez widoku innych procesów, bo sandbox sesji montuje `node_modules/.bin` tylko do odczytu. Po zapisie manifestu zależności z planu hook `PostToolUse` instaluje zależności ponownie poleceniem `commands.update_lockfile` i aktualizuje lockfile (#49); bez tego polecenia w `.sdlc-agents.yml` sesja nie zmieni zależności. Sesja dostaje bieżącą wersję planu i końcówki logów niezaliczonych jobów bramek ostatniego pushu (FR-4.12).

Po sesji kod joba ([src/orchestrator/developer-effects.ts](src/orchestrator/developer-effects.ts)):

1. usuwa puste pliki, które sandbox sesji tworzy w przestrzeni roboczej jako punkty montowania chronionych ścieżek ([src/git/sandbox-placeholders.ts](src/git/sandbox-placeholders.ts)), i commituje zmiany z komunikatem Conventional Commits z numerem issue, który składa sam (FR-4.9);
2. odrzuca branch z niepoprawionymi konfliktami, zagnieżdżonymi repozytoriami, ścieżkami z `hooks.deny_paths` albo ponad 200 zmienionymi plikami;
3. publikuje aktualizację planu jako nową wersję z powodem i pełną listą plików (FR-4.11). Wersja high-impact zdejmuje `plan:approved` i czeka na akceptację bez pushu;
4. zakłada issue spoza zakresu (FR-4.10);
5. pushuje tokenem App na branch `<typ>/<numer-issue>-<opis z tytułu issue>` (FR-4.7) i otwiera draft PR z `Closes #<numer>`, linkiem do planu, issue spoza zakresu i poprzednim PR (FR-4.8).

## Bramka zakresu

Bramka zakresu ([src/gates/scope](src/gates/scope)) działa w workflow bramek repozytorium demo jako reusable workflow [scope-gate.yml](.github/workflows/scope-gate.yml) przypięty commitem tego repozytorium. Dotyczy PR przebiegu, czyli PR bota z brancha przebiegu tego repozytorium. Każdy plik, który PR zmienia, musi być w najnowszym planie, który App opublikowała w issue. Zmieniona nazwa wymaga obu ścieżek, a lockfile spoza planu jest dozwolony tylko obok manifestu zależności z planu (QG-7.9). Bramka czyta tylko publiczne dane tokenem workflow do odczytu, więc nie potrzebuje sekretu.

Cienki workflow repozytorium demo przekazuje do `orchestrate.yml` sekret `CLAUDE_CODE_OAUTH_TOKEN` po nazwie, tak jak do `agent-trial.yml`. Joby ról instalują Claude Code i sandbox akcją [agent-setup](.github/actions/agent-setup/action.yml), a w podsumowaniu kroku publikują tylko podsumowania sesji, bez transkryptu.

## Autor

T. Stokłosa
