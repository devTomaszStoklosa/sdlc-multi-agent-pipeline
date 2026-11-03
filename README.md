# Wieloagentowy pipeline SDLC

Specyfikacja pipeline'u, w którym wyspecjalizowani agenci AI przejmują GitHub Issue oznaczone przez człowieka, implementują zmianę, recenzują ją w pętli i wdrażają na środowisko dev. Finalna akceptacja i merge zostają w rękach człowieka.

## Zawartość

- [intent.md](intent.md): intencja, czyli problem, oczekiwany rezultat, ograniczenia i pytania otwarte.
- [spec.md](spec.md): specyfikacja, czyli przebieg i maszyna stanów, agenci, bramki, bezpieczeństwo, hooki, konfiguracja repozytorium, ewaluacje, porównanie frameworków, metryki i rollout.
- [plan.md](plan.md): plan techniczny MVP, czyli decyzje przy warunku zera kosztów, architektura, ochrona tokenu subskrypcji, przyrosty P0–P8, fazy po MVP i śledzenie wymagań.
- [docs/e2e-mvp-report.md](docs/e2e-mvp-report.md): raport z testu end-to-end MVP (P8), czyli wyniki issue testowych, zużycie, blokady hooków, przegląd wycieku i poprawki.
- [docs/onboarding.md](docs/onboarding.md): instrukcja podłączenia repozytorium do pipeline'u, czyli GitHub App, środowisko `agents`, `.sdlc-agents.yml`, kontrakt bramek, cienkie workflow, etykiety i rulesety.
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
- `npm run gate-config -- <.sdlc-agents.yml>`: polecenia i progi bramek z konfiguracji scalonej z bazą organizacji, zapisane w pliku `GITHUB_OUTPUT`. Kody wyjścia jak w `validate-config`; brak pliku to konfiguracja niepoprawna.
- `npm run coverage-gate -- <bazowy.json> <head.json> <tolerancja>`: porównanie pokrycia linii z raportów istanbul `json-summary` (QG-7.6). Brak raportu bazowego oznacza commit bez pokrycia.
- `npm run sast-gate -- <katalog-bazowy> <katalog-head> <próg>`: nowe alerty bezpieczeństwa CodeQL z plików `.sarif` na progu lub wyżej (QG-7.2).
- `npm run egress -- <plik-workflow> <job>`: lista `allowed-endpoints` harden-runnera dla joba, do wklejenia w workflow (SEC-8.4).

## Bramki

Repozytorium docelowe wywołuje reusable workflow [gates.yml](.github/workflows/gates.yml) z cienkiego workflow bramek, przypiętego pełnym SHA commita w `uses:` i w wejściu `pipeline-ref`. Job `config` czyta `.sdlc-agents.yml` z commitu bazowego PR, więc PR nie zmieni własnych poleceń ani progów. Pozostałe joby uruchamiają polecenia `commands.*` repozytorium oraz narzędzia pipeline'u: jscpd, gitleaks, commitlint, `dependency-review-action` i CodeQL z porównaniem z commitem bazowym. Każdy job jest wymaganym checkiem rulesetu bramek pod nazwą `<job wywołujący> / <job>` (rozdz. 3.6 planu), łącznie z `config` i jobami CodeQL `sast-head (<język>)` i `sast-base (<język>)`. Job pominięty po niezaliczonej zależności ma stan `skipped`, a wymagany check w tym stanie przechodzi, więc bez nich niepoprawna konfiguracja albo błąd CodeQL nie blokowałyby merge'u. Joby `build` i `coverage` są pomijane, gdy repozytorium nie ma polecenia.

Kontrakt repozytorium:

- `commands.format` przyjmuje ścieżki plików; bramka uruchamia je z `.` i wymaga, żeby nie zmieniło żadnego pliku.
- Konfiguracja lintera czyta próg złożoności z `SDLC_MAX_FUNCTION_COMPLEXITY`, a `commands.lint` kończy się błędem przy znaleziskach na poziomie `SDLC_STATIC_ANALYSIS_FAIL_ON` lub wyższym. Te same zmienne dostają polecenia hooków agenta.
- `commands.coverage` zapisuje raport istanbul `json-summary` w `coverage/coverage-summary.json`.
- Job wywołujący `gates.yml` nadaje `contents: read` i `security-events: write`, bo CodeQL wysyła wyniki head do code scanning.

## Hooki agentów

Hooki z rozdz. 9.2 specyfikacji są w [src/hooks](src/hooks). Claude Code uruchamia je poleceniem `node --experimental-strip-types src/hooks/cli.ts <zdarzenie> --context <hook-context.json>`, a zdarzenie podaje na wejściu standardowym.

- `PreToolUse`: każda reguła to osobna polityka w [src/hooks/policies](src/hooks/policies). Blokada kończy hook kodem 2 i trafia do logu audytowego z kategorią z M-E01. Hook nigdy nie odpowiada „allow”, więc reguły uprawnień Claude Code nadal działają.
- `PostToolUse`: redakcja sekretów w wyniku narzędzia, formatter i linter na zapisanym pliku, log audytowy wywołań w JSONL.
- `PostToolUseFailure`: log audytowy wywołań, które się nie powiodły.
- `Stop`: Developer nie kończy pracy, dopóki nie przechodzą `commands.lint` i `commands.test`. Decyzja trafia do logu audytowego, a podsumowanie sesji liczy ją osobno.
- Każdy błąd, niepoprawne wejście albo przekroczenie czasu blokuje akcję albo wstrzymuje wynik narzędzia. Proces, który nie wystartuje, blokuje akcję dzięki ustawieniu `onFailure: "block"`.

Polecenia projektu (formatter, linter, testy) hooki uruchamiają w [bubblewrap](https://github.com/containers/bubblewrap) bez sieci, bez widoku innych procesów i z zapisem tylko w przestrzeni roboczej, bo te polecenia wykonują kod zmieniany przez agenta (rozdz. 3.4 planu). Testy tej izolacji działają tylko na Linuksie z `bwrap`. Lokalnie są pomijane, a w CI (`REQUIRE_SANDBOX=1`) nie mogą być pominięte.

Analiza poleceń powłoki to heurystyka: nie widzi zawartości uruchamianych skryptów ani nazw plików powstałych z rozwinięcia wzorców. Drugą warstwą jest sandbox Claude Code (SEC-9.0c).

## Ruch wychodzący jobów

Każdy job workflowów `orchestrate.yml`, `gates.yml`, `scope-gate.yml`, `terminate.yml` i `agent-trial.yml` zaczyna się od [harden-runnera](https://github.com/step-security/harden-runner) w trybie `block`, bez telemetrii (SEC-8.4, rozdz. 4 planu). Połączenie z hostem spoza listy joba kończy się błędem, a log post-stepu harden-runnera zawiera wpis `domain not allowed: <host>`.

- Listy składa [src/config/egress.ts](src/config/egress.ts) z grup hostów zebranych w trybie `audit` (#68): GitHub dla każdego joba, rejestr npm pipeline'u, `network.allowed_hosts` z bazy organizacji dla jobów z poleceniami repozytorium i sesją agenta, Anthropic i apt tylko dla sesji agenta, Scorecard dla `dependency-review`.
- Listy są wpisane w workflowach, żeby było je widać w review. Test `src/config/egress.test.ts` pilnuje, że są równe wynikowi modułu. Po zmianie grupy albo `network.allowed_hosts` listę joba wypisuje `npm run egress -- <plik-workflow> <job>`.
- Repozytorium nie dodaje hostów (FR-10.2). Host potrzebny poleceniom repozytorium trafia do `network.allowed_hosts` bazy organizacji.
- Job, który padł na blokadzie, ma w logu post-stepu harden-runnera wpis `domain not allowed`. Hosty pobierania akcji zmieniają się między wersjami, więc po aktualizacji akcji warto puścić jej joby w trybie `audit`.

Ograniczenia:

- Tryb `block` jest darmowy (tier Community) tylko dla repozytoriów publicznych na runnerach GitHuba. Repozytorium prywatne wymaga tieru Enterprise.
- `*.blob.core.windows.net` przepuszcza każde konto Azure Storage, bo GitHub zapisuje logi i artefakty na kontach o zmiennych nazwach. To droga wyprowadzenia danych, której lista nie zamyka.
- Harden-runner w wersji v2.22.2 odcinał dozwolone połączenia, gdy odpowiadał resolver DNS testowany przez GitHub na runnerach ([step-security/harden-runner#708](https://github.com/step-security/harden-runner/issues/708)). Workflowy używają v2.22.3 z poprawką.

Próbną sesję na runnerze uruchamia reusable workflow [agent-trial.yml](.github/workflows/agent-trial.yml), wywoływany z ręcznego workflow na `main` repozytorium demo.

## Orchestrator

Przebieg sterują dwa reusable workflows wywoływane z cienkich workflow repozytorium demo (rozdz. 3.5 planu):

- [orchestrate.yml](.github/workflows/orchestrate.yml): job `filter` odrzuca zdarzenia botów i obcych, `decide` w grupie `concurrency` per issue liczy przejście maszyny stanów, a potem działają najwyżej dwie pary job roli i `advance`. Job roli wykonuje skutki uboczne tokenem roli, a `advance` zapisuje stan.
- [terminate.yml](.github/workflows/terminate.yml): zatrzymanie etykietą `agent:stop` i zakończenie po zamknięciu lub merge'u PR. Job `cancel` poza grupą anuluje run przebiegu, a `finalize` zapisuje stan końcowy, zdejmuje etykiety, kończy `agent-review` i publikuje podsumowanie zatrzymania.

W trakcie sesji roli job co 15 s sprawdza etykiety issue i PR oraz stan PR i po `agent:stop` albo zamknięciu PR przerywa sesję, bo GitHub dostarcza anulowanie do działającego kroku z opóźnieniem ok. minuty.

Stan przebiegu jest w ukrytym komentarzu GitHub App w issue ([src/core/run-store](src/core/run-store)), a przejścia w [src/core/state-machine](src/core/state-machine). Każdy job zapisuje log zdarzeń w JSONL i wgrywa go jako artefakt `run-events-<job>-<próba>`.

Ręczne uruchomienie workflow Orchestrate z numerem issue startuje przebieg czekający w kolejce, gdy nie ma innego aktywnego przebiegu, odbiera wynik bramek, który nie dotarł, a etap, którego job zakończył się bez wyniku, kieruje do `needs-human`.

W testach role zastępują zaślepki ([src/agents/stub-role.ts](src/agents/stub-role.ts)), które nie zużywają limitu planu Pro. Ich zachowanie ustala ukryty blok w treści issue, np.:

```text
<!-- sdlc-stub
plans: [high-impact, normal]      # rodzaj planu w kolejnych wersjach
plan_update: high-impact          # pierwszy etap Developera aktualizuje plan
verdicts: [changes_requested, approve]
repeat_finding: true              # znalezisko zostaje otwarte w kolejnej rundzie
failures:
  planner: [infra, usage-limit]   # nieudane próby etapu: infra, usage-limit, max-turns
delay_seconds:
  developer: 120                  # długa sesja, np. do testu zatrzymania
cost_usd: 0.01                    # szacunek kosztu każdej sesji
-->
```

Bez bloku zaślepka Reviewera zwraca review bez znalezisk, czyli `approve`. Ostatni element listy obowiązuje dla kolejnych wystąpień. W repozytorium demo wszystkie role pracują na Claude Code, więc blok działa tylko w testach.

## Planner

Planner działa w jobie roli jako sesja `claude -p` ([src/agents/claude-runner.ts](src/agents/claude-runner.ts)) z modelem i promptem z [prompts/roles.yml](prompts/roles.yml), narzędziami tylko do odczytu, limitem tur z kopii `.sdlc-agents.yml` przebiegu i hookami z [src/hooks](src/hooks). Prompt trafia na wejście standardowe, a plan wraca jako wynik ustrukturyzowany według schematu z [src/agents/planner/plan.ts](src/agents/planner/plan.ts) (`--json-schema`). Proces `claude` dostaje token Claude, ale żadnego tokenu GitHub ani Actions (rozdz. 3.2 planu).

Kod joba przed sesją zbiera dane dla Plannera: issue, komentarze osób z prawem zapisu, wcześniejsze wersje planu, podsumowanie zatrzymania poprzedniego przebiegu i diff brancha jego otwartego PR (FR-4.28b). Wszystko to trafia do promptu jako niezaufane dane (SEC-8.5).

Po sesji kod joba waliduje plan, klasyfikuje go i publikuje jako nowy komentarz z numerem wersji (FR-4.3, FR-4.6). Zmiana jest high-impact, gdy wskaże ją Planner albo któraś reguła z [src/agents/planner/high-impact.ts](src/agents/planner/high-impact.ts): manifest zależności, pliki CI, infrastruktury i konfiguracji bramek z `.sdlc-agents.yml`, `high_impact.extra_paths` albo limity plików i linii. Przed publikacją wersji high-impact job zdejmuje `plan:approved` (FR-4.5). Lista plików jest w bloku ` ```yaml sdlc-plan `, który czyta `parsePlanBlock`.

## Developer

Developer działa w jobie roli jako sesja `claude -p` z modelem i promptem z [prompts/roles.yml](prompts/roles.yml), narzędziami do odczytu, edycji i poleceń powłoki w sandboxie oraz hookami z [src/hooks](src/hooks). Sandbox nie pozwala poleceniom zapisywać w kodzie pipeline'u, w katalogu sesji ani w `$RUNNER_TEMP`, które leżą obok przestrzeni roboczej w katalogu domowym runnera. Sesja nie commituje i nie pushuje: zostawia zmiany w przestrzeni roboczej i zwraca według schematu z [src/agents/developer/work.ts](src/agents/developer/work.ts) typ i temat commita, podsumowanie, issue spoza zakresu i opcjonalną aktualizację planu.

Przed sesją kod joba przenosi `.git` checkoutu do własnego katalogu w `$RUNNER_TEMP` ([src/git](src/git)), a sesji zostawia kopię. Polecenia git joba działają na tym katalogu bez konfiguracji systemowej, globalnej i hooków, więc nic, co zapisała sesja, nie uruchamia się w jobie z tokenami. Job przełącza przestrzeń roboczą na branch przebiegu, a w pierwszym etapie przebiegu, który kontynuuje otwarty PR, scala do niego `main` i zostawia konflikty sesji (FR-4.28b). Potem instaluje zależności poleceniem `commands.install` w bubblewrap z siecią, ale bez tokenów joba i bez widoku innych procesów, bo sandbox sesji montuje `node_modules/.bin` tylko do odczytu. Po zapisie manifestu zależności z planu hook `PostToolUse` instaluje zależności ponownie poleceniem `commands.update_lockfile` i aktualizuje lockfile (#49); bez tego polecenia w `.sdlc-agents.yml` sesja nie zmieni zależności. Sesja dostaje bieżącą wersję planu, końcówki logów niezaliczonych jobów bramek ostatniego pushu (FR-4.12) i otwarte znaleziska ostatniego review z prośbą o zmiany (FR-4.15). Znalezisko, które uważa za błędne, sesja zostawia bez zmiany kodu i wyjaśnia w `replies`.

Po sesji kod joba ([src/orchestrator/developer-effects.ts](src/orchestrator/developer-effects.ts)):

1. usuwa puste pliki, które sandbox sesji tworzy w przestrzeni roboczej jako punkty montowania chronionych ścieżek ([src/git/sandbox-placeholders.ts](src/git/sandbox-placeholders.ts)), i commituje zmiany z komunikatem Conventional Commits z numerem issue, który składa sam (FR-4.9);
2. odrzuca branch z niepoprawionymi konfliktami, zagnieżdżonymi repozytoriami, ścieżkami z `hooks.deny_paths` albo ponad 200 zmienionymi plikami;
3. publikuje aktualizację planu jako nową wersję z powodem i pełną listą plików (FR-4.11). Wersja high-impact zdejmuje `plan:approved` i czeka na akceptację bez pushu;
4. zakłada issue spoza zakresu (FR-4.10);
5. publikuje odpowiedzi na znaleziska w ich wątkach ([src/orchestrator/developer-replies.ts](src/orchestrator/developer-replies.ts)). Gdy sesja tylko odpowiedziała na review bieżącego commita i nic nie zmieniła, commit jest pusty: jego push uruchamia bramki i kolejną rundę review, bo bez zdarzenia GitHuba run workflow nie uruchomi trzeciej roli (FR-4.15);
6. pushuje tokenem App na branch `<typ>/<numer-issue>-<opis z tytułu issue>` (FR-4.7) i otwiera draft PR z `Closes #<numer>`, linkiem do planu, issue spoza zakresu i poprzednim PR (FR-4.8).

## Reviewer

Reviewer działa w jobie roli jako sesja `claude -p` z modelem i promptem z [prompts/roles.yml](prompts/roles.yml), innym modelem niż Developer (FR-5.5, test w [src/agents/roles-config.test.ts](src/agents/roles-config.test.ts)), i tylko z narzędziami do odczytu (FR-5.4). Przestrzeń robocza jest na recenzowanym commicie, czyli ostatnim pushu przebiegu. Kod joba zbiera dla sesji tokenem workflow tylko do odczytu issue, plan, cały diff PR względem `main`, wyniki jobów bramek i otwarte znaleziska poprzedniej rundy z odpowiedziami Developera ([src/orchestrator/reviewer-brief.ts](src/orchestrator/reviewer-brief.ts)). Opisu PR, komunikatów commitów ani niczego z sesji Developera sesja nie dostaje (FR-5.3).

Sesja zwraca według schematu z [src/agents/reviewer/review.ts](src/agents/reviewer/review.ts) znaleziska (plik, linia, reguła, waga, opis, sugestia) i ocenę każdego wcześniejszego znaleziska. Po sesji kod joba ([src/orchestrator/reviewer-effects.ts](src/orchestrator/reviewer-effects.ts)):

1. liczy identyfikator znaleziska `F-<12 znaków sha256>` z reguły, pliku i treści linii ze znormalizowanymi białymi znakami ([src/agents/reviewer/finding-id.ts](src/agents/reviewer/finding-id.ts)), więc to samo znalezisko ma ten sam identyfikator w każdej rundzie (FR-4.14, FR-4.18);
2. ustala werdykt: otwarte znalezisko blokujące, także nierozwiązane albo nieocenione z poprzedniej rundy, daje `changes_requested`, a brak takich znalezisk `approve` (FR-4.17);
3. publikuje jedno review PR, które tylko komentuje, bo port review nie ma approvalu (FR-5.2, FR-6.2). Każde znalezisko ma komentarz na swojej linii, gdy diff ją pokazuje, a w przeciwnym razie na swoim pliku. Treść review ma ukryty blok `sdlc-review` z danymi rundy, które czytają Developer, kolejna runda i opis PR;
4. kończy check run `agent-review` wynikiem `success` albo `failure` z linkiem do review.

Powtórzone otwarte znalezisko albo limit rund kończą przebieg w `needs-human`, a komentarz eskalacyjny wymienia otwarte znaleziska blokujące (FR-4.18). Po `approve` job `advance` dopisuje do opisu PR plan, wyniki bramek, rundy review z rozwiązanymi znaleziskami i otwarte znaleziska nieblokujące, kończy szkic PR i prosi o review osoby przypisane do issue. Bez przypisanych o review code ownerów prosi GitHub przy wyjściu PR ze szkicu (FR-4.20, FR-6.4).

## Bramka zakresu

Bramka zakresu ([src/gates/scope](src/gates/scope)) działa w workflow bramek repozytorium demo jako reusable workflow [scope-gate.yml](.github/workflows/scope-gate.yml) przypięty commitem tego repozytorium. Dotyczy PR przebiegu, czyli PR bota z brancha przebiegu tego repozytorium. Każdy plik, który PR zmienia, musi być w najnowszym planie, który App opublikowała w issue. Zmieniona nazwa wymaga obu ścieżek, a lockfile spoza planu jest dozwolony tylko obok manifestu zależności z planu (QG-7.9). Bramka czyta tylko publiczne dane tokenem workflow do odczytu, więc nie potrzebuje sekretu.

Cienki workflow repozytorium demo przekazuje do `orchestrate.yml` sekret `CLAUDE_CODE_OAUTH_TOKEN` po nazwie, tak jak do `agent-trial.yml`. Joby ról instalują Claude Code i sandbox akcją [agent-setup](.github/actions/agent-setup/action.yml), a w podsumowaniu kroku publikują tylko podsumowania sesji, bez transkryptu.

## Autor

T. Stokłosa
