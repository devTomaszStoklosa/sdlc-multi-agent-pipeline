# Wieloagentowy pipeline SDLC

Specyfikacja pipeline'u, w którym wyspecjalizowani agenci AI przejmują GitHub Issue oznaczone przez człowieka, implementują zmianę, recenzują ją w pętli i wdrażają na środowisko dev. Finalna akceptacja i merge zostają w rękach człowieka.

## Zawartość

- [intent.md](intent.md): intencja, czyli problem, oczekiwany rezultat, ograniczenia i pytania otwarte.
- [spec.md](spec.md): specyfikacja, czyli przebieg i maszyna stanów, agenci, bramki, bezpieczeństwo, hooki, konfiguracja repozytorium, ewaluacje, porównanie frameworków, metryki i rollout.
- [plan.md](plan.md): plan techniczny MVP, czyli decyzje przy warunku zera kosztów, architektura, ochrona tokenu subskrypcji, przyrosty P0–P8, fazy po MVP i śledzenie wymagań.
- [config/org-baseline.yml](config/org-baseline.yml): bazowy zestaw organizacji, czyli najłagodniejsze dopuszczalne wartości `.sdlc-agents.yml`, które repozytorium może tylko zaostrzyć (FR-10.2), oraz lista hostów sieciowych, której repozytorium nie zmienia.

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
- `npm run prepare-session -- --role <rola> --workspace <katalog> --config <.sdlc-agents.yml> --out <katalog>`: zapisuje kontekst hooków i ustawienia Claude Code dla sesji agenta (rozdz. 3.4 planu). Katalog wyjściowy musi leżeć poza przestrzenią roboczą. Kody wyjścia jak w `validate-config`.
- `npm run session-summary -- --result <wynik.json> --audit <log.jsonl>`: podsumowanie sesji w Markdown bez transkryptu, z redakcją sekretów.

## Hooki agentów

Hooki z rozdz. 9.2 specyfikacji są w [src/hooks](src/hooks). Claude Code uruchamia je poleceniem `node --experimental-strip-types src/hooks/cli.ts <zdarzenie> --context <hook-context.json>`, a zdarzenie podaje na wejściu standardowym.

- `PreToolUse`: każda reguła to osobna polityka w [src/hooks/policies](src/hooks/policies). Blokada kończy hook kodem 2 i trafia do logu audytowego z kategorią z M-E01. Hook nigdy nie odpowiada „allow”, więc reguły uprawnień Claude Code nadal działają.
- `PostToolUse`: redakcja sekretów w wyniku narzędzia, formatter i linter na zapisanym pliku, log audytowy wywołań w JSONL.
- `PostToolUseFailure`: log audytowy wywołań, które się nie powiodły.
- `Stop`: Developer nie kończy pracy, dopóki nie przechodzą `commands.lint` i `commands.test`.
- Każdy błąd, niepoprawne wejście albo przekroczenie czasu blokuje akcję albo wstrzymuje wynik narzędzia. Proces, który nie wystartuje, blokuje akcję dzięki ustawieniu `onFailure: "block"`.

Polecenia projektu (formatter, linter, testy) hooki uruchamiają w [bubblewrap](https://github.com/containers/bubblewrap) bez sieci, bez widoku innych procesów i z zapisem tylko w przestrzeni roboczej, bo te polecenia wykonują kod zmieniany przez agenta (rozdz. 3.4 planu). Testy tej izolacji działają tylko na Linuksie z `bwrap`. Lokalnie są pomijane, a w CI (`REQUIRE_SANDBOX=1`) nie mogą być pominięte.

Analiza poleceń powłoki to heurystyka: nie widzi zawartości uruchamianych skryptów ani nazw plików powstałych z rozwinięcia wzorców. Drugą warstwą jest sandbox Claude Code (SEC-9.0c).

Próbną sesję na runnerze uruchamia reusable workflow [agent-trial.yml](.github/workflows/agent-trial.yml), wywoływany z ręcznego workflow na `main` repozytorium demo.

## Autor

T. Stokłosa
