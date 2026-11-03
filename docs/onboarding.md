# Podłączenie repozytorium do pipeline'u

Instrukcja dla właściciela repozytorium, które ma obsługiwać pipeline. Wzorem jest repozytorium demo [`sdlc-pipeline-sandbox`](https://github.com/devTomaszStoklosa/sdlc-pipeline-sandbox), podłączone w P3 i P4 ([plan.md](../plan.md), rozdz. 5). Kroki wykonuje człowiek z rolą administratora repozytorium. Tokenów i kluczy nie wpisuje agent (rozdz. 10 planu).

Kolejność ma znaczenie: `.sdlc-agents.yml` musi być na `main`, zanim zadziała workflow bramek, a rulesety najlepiej włączyć na końcu, gdy nazwy checków są już widoczne w pierwszym PR.

## 1. Warunki

- Repozytorium publiczne na runnerach hostowanych przez GitHub. Harden-runner w trybie `block` jest darmowy tylko dla repozytoriów publicznych (README, „Ruch wychodzący jobów”).
- Stack, w którym da się podać polecenia z rozdz. 4 i spełnić kontrakt bramek z rozdz. 5. Pipeline był sprawdzony na TypeScript z npm.
- Hosty potrzebne poleceniom repozytorium (rejestr pakietów, pobieranie narzędzi) są w `network.allowed_hosts` [bazy organizacji](../config/org-baseline.yml). Repozytorium nie dodaje hostów (FR-10.2), więc brakujący host trafia tam przez PR w tym repozytorium, a potem do list jobów (`npm run egress -- <plik-workflow> <job>`).
- Plan Claude z Claude Code i konto, na którym działa `claude setup-token`.

## 2. Ustawienia repozytorium

W **Settings → Actions → General**:

- **Fork pull request workflows from outside collaborators:** „Require approval for all external contributors”.
- **Workflow permissions:** „Read repository contents and packages permissions”, bez „Allow GitHub Actions to create and approve pull requests”.

W **Settings → Advanced Security** włączyć **Dependency graph**. Nowe repozytorium publiczne może go nie mieć, a bez niego job `dependency-review` kończy się błędem (QG-7.4).

Nie dodawać workflow z wyzwalaczem `pull_request_target` (rozdz. 4 planu, FR-4.33).

## 3. GitHub App i środowisko `agents`

1. Utworzyć GitHub App (**Settings → Developer settings → GitHub Apps**) z uprawnieniami repozytorium:
   - Contents, Pull requests, Issues, Checks: **Read and write**;
   - Metadata: **Read-only**;
   - bez uprawnienia **Workflows**, żeby agent nie zmienił CI (SEC-9.1, OQ-8);
   - webhook wyłączony, bo zdarzenia dostarcza GitHub Actions.
2. Wygenerować klucz prywatny i zainstalować aplikację z dostępem tylko do wybranych repozytoriów („Only select repositories”), w tym podłączanego.
3. W repozytorium (**Settings → Secrets and variables → Actions**) dodać:
   - sekret repozytorium `APP_PRIVATE_KEY` z kluczem prywatnym;
   - zmienną `APP_CLIENT_ID` z Client ID aplikacji (parametr `client-id` akcji `actions/create-github-app-token`);
   - zmienną `APP_ID` z identyfikatorem aplikacji (autor komentarza ze stanem i planów, źródło checku `agent-review`).
4. Utworzyć środowisko `agents` (**Settings → Environments**) z **Deployment branches and tags** ograniczonymi do `main` („Selected branches and tags”, reguła `main`).
5. Uruchomić lokalnie `claude setup-token` i dodać wynik jako **sekret środowiska** `agents` o nazwie `CLAUDE_CODE_OAUTH_TOKEN`, nie jako sekret repozytorium. Odczyta go tylko job roli, który działa w tym środowisku (SEC-8.2).

Na wypadek wycieku tokenu: unieważnić go, wygenerować nowy przez `claude setup-token`, podmienić sekret w środowisku `agents` i przejrzeć logi i artefakty workflow od chwili możliwego wycieku. Rotacja planowa raz na kwartał (rozdz. 4 planu).

## 4. `.sdlc-agents.yml`

Plik w katalogu głównym repozytorium (FR-10.1). Przebieg używa kopii z `main` z chwili swojego startu (FR-10.5), a bramki pliku z commitu bazowego PR (rozdz. 3.6 planu). Każde pole poza `commands` i `version` jest opcjonalne: brak pola oznacza wartość [bazy organizacji](../config/org-baseline.yml), a wartość łagodniejsza od bazy jest błędem walidacji (FR-10.2).

```yaml
# .sdlc-agents.yml
version: 1

commands:
  install: npm ci
  # Optional. Without it a plan that changes a dependency manifest escalates.
  # No install scripts, because the session may name another package than the plan.
  update_lockfile: npm install --ignore-scripts
  build: npm run typecheck # optional
  test: npm test
  lint: npm run lint -- --no-warn-ignored
  format: npx prettier --write --ignore-unknown
  coverage: npm run coverage # optional

# Optional tightening of the organization baseline.
gates:
  max_function_complexity: 8

high_impact:
  extra_paths:
    - "src/auth/**"

limits:
  max_minutes_per_run: 30
```

Polecenia:

- `install` instaluje zależności przed sesją Developera i w jobach bramek. W sesji działa w bubblewrap z siecią, ale bez tokenów joba (rozdz. 3.4 planu).
- `update_lockfile` uruchamia hook po zapisie manifestu zależności z zaakceptowanego planu. Musi aktualizować lockfile bez skryptów instalacji (np. `npm install --ignore-scripts`).
- `format` i `lint` przyjmują dopisane ścieżki plików i nie zgłaszają błędu dla plików, których narzędzie nie obsługuje (`prettier --ignore-unknown`, `eslint --no-warn-ignored`). Hook `PostToolUse` dopisuje do nich ścieżkę edytowanego pliku (QG-9.9).
- `test` i `lint` uruchamia też hook `Stop` przed końcem pracy Developera (QG-9.12).
- Hooki uruchamiają polecenia w bubblewrap bez sieci, więc `format`, `lint` i `test` nie mogą niczego pobierać.

Sekcja `labels` zmienia nazwy `agent:ready`, `needs-human` i `plan:approved`. Etykieta `agent:stop` jest stała (FR-10.4). Zmiana `.sdlc-agents.yml` jest zawsze high-impact (FR-10.3).

Plik sprawdza CLI pipeline'u z checkoutu tego repozytorium (ścieżka względna wobec niego):

```bash
npm run validate-config -- ../<repozytorium>/.sdlc-agents.yml
```

Kod wyjścia 0 oznacza poprawną konfigurację. Plik trafia na `main` pierwszym PR repozytorium, przed workflow bramek, bo job `config` bez poprawnego pliku kończy się błędem.

## 5. Kontrakt bramek

Bramki z rozdz. 3.6 planu uruchamiają polecenia repozytorium, więc repozytorium musi:

- **Format:** `commands.format .` nie zmienia żadnego pliku na czystym drzewie.
- **Analiza statyczna i złożoność:** konfiguracja lintera czyta próg złożoności ze zmiennej `SDLC_MAX_FUNCTION_COMPLEXITY`, a `commands.lint` kończy się błędem przy znaleziskach na poziomie `SDLC_STATIC_ANALYSIS_FAIL_ON` (`error` albo `warning`) lub wyższym. Te same zmienne dostają polecenia hooków agenta (QG-7.12). Przykład dla ESLint:

  ```js
  rules: {
    complexity: ["error", Number(process.env.SDLC_MAX_FUNCTION_COMPLEXITY ?? 10)],
  },
  ```

  Przy `static_analysis_fail_on: warning` polecenie lint musi odrzucać ostrzeżenia, np. przez `--max-warnings=0`.
- **Pokrycie:** `commands.coverage` zapisuje raport istanbul `json-summary` w `coverage/coverage-summary.json` (w Vitest `coverage.reporter: ["json-summary"]`). Bramka porównuje go z raportem commitu bazowego.
- **Commity:** Conventional Commits z odwołaniem do issue (commitlint z regułami pipeline'u, FR-4.9). Lokalne hooki gita (lefthook z formatterem, linterem i gitleaks) są zalecane, a CI powtarza te sprawdzenia (QG-9.13, QG-9.14).
- **Duplikacja i sekrety:** jscpd i gitleaks pipeline'u działają bez konfiguracji repozytorium. Plik `.jscpd.json` repozytorium może wykluczyć ścieżki, np. raporty.

Zmiana konfiguracji lintera, testów i innych plików bramek jest high-impact (QG-7.11), więc człowiek widzi, czy narzędzie dalej czyta progi.

## 6. Cienkie workflow

Pięć plików w `.github/workflows/` wywołuje reusable workflows tego repozytorium. Każdy przypina pipeline pełnym SHA commita z `main` tego repozytorium, takim samym w `uses:` i w `pipeline-ref`, bo tag da się przesunąć (rozdz. 3.1 planu). W przykładach `<sha>` oznacza ten commit. Przepięcie na nowszy commit to zwykły PR, który zmienia wszystkie wystąpienia naraz.

Nazwy workflow i jobów są częścią kontraktu: `Gates` czyta `orchestrate.yml` (wejście `gates-workflow`), a nazwy checków w rulesecie to `<job wywołujący> / <job>`.

### `gates.yml`

```yaml
name: Gates

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  gates:
    uses: devTomaszStoklosa/sdlc-multi-agent-pipeline/.github/workflows/gates.yml@<sha>
    permissions:
      contents: read
      security-events: write
    with:
      pipeline-ref: <sha>
      # codeql-languages: '["actions", "javascript-typescript"]'

  scope:
    if: github.event_name == 'pull_request'
    uses: devTomaszStoklosa/sdlc-multi-agent-pipeline/.github/workflows/scope-gate.yml@<sha>
    permissions:
      contents: read
      issues: read
      pull-requests: read
    with:
      pipeline-ref: <sha>
      app-id: ${{ vars.APP_ID }}
```

`codeql-languages` to tablica JSON języków CodeQL repozytorium. Domyślna wartość pasuje do TypeScript z workflow GitHub Actions.

### `orchestrate.yml`

```yaml
name: Orchestrate

on:
  issues:
    types: [labeled, unlabeled]
  issue_comment:
    types: [created]
  workflow_run:
    workflows: [Gates]
    types: [completed]
  workflow_dispatch:
    inputs:
      issue:
        description: Number of the issue
        required: true
        type: string

permissions:
  contents: read

jobs:
  orchestrate:
    uses: devTomaszStoklosa/sdlc-multi-agent-pipeline/.github/workflows/orchestrate.yml@<sha>
    permissions:
      actions: read
      contents: read
      issues: read
      pull-requests: read
    with:
      pipeline-ref: <sha>
      app-client-id: ${{ vars.APP_CLIENT_ID }}
      app-id: ${{ vars.APP_ID }}
    secrets:
      APP_PRIVATE_KEY: ${{ secrets.APP_PRIVATE_KEY }}
      CLAUDE_CODE_OAUTH_TOKEN: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
```

Sekret `CLAUDE_CODE_OAUTH_TOKEN` trzeba przekazać po nazwie, choć istnieje tylko w środowisku `agents`: bez tego reusable workflow dostaje pusty napis. Odczytuje go tylko job roli w tym środowisku.

### `stop.yml`

```yaml
name: Stop

on:
  issues:
    types: [labeled]
  pull_request:
    types: [labeled]

permissions:
  contents: read

jobs:
  stop:
    if: github.event.label.name == 'agent:stop'
    uses: devTomaszStoklosa/sdlc-multi-agent-pipeline/.github/workflows/terminate.yml@<sha>
    permissions:
      actions: write
      contents: read
      issues: read
      pull-requests: read
    with:
      pipeline-ref: <sha>
      app-client-id: ${{ vars.APP_CLIENT_ID }}
      app-id: ${{ vars.APP_ID }}
    secrets:
      APP_PRIVATE_KEY: ${{ secrets.APP_PRIVATE_KEY }}
```

### `pr-closed.yml`

```yaml
name: Pull request closed

on:
  pull_request:
    types: [closed]

permissions:
  contents: read

jobs:
  pr-closed:
    uses: devTomaszStoklosa/sdlc-multi-agent-pipeline/.github/workflows/terminate.yml@<sha>
    permissions:
      actions: write
      contents: read
      issues: read
      pull-requests: read
    with:
      pipeline-ref: <sha>
      app-client-id: ${{ vars.APP_CLIENT_ID }}
      app-id: ${{ vars.APP_ID }}
    secrets:
      APP_PRIVATE_KEY: ${{ secrets.APP_PRIVATE_KEY }}
```

`actions: write` w `stop.yml` i `pr-closed.yml` wykorzystuje tylko job `cancel`, który anuluje run przebiegu tokenem `GITHUB_TOKEN` (rozdz. 2.2 planu).

### Próbna sesja (opcjonalnie)

Reusable workflow [agent-trial.yml](../.github/workflows/agent-trial.yml) uruchamia jedną sesję Claude Code z hookami bez przebiegu. Repozytorium wywołuje go z ręcznego workflow (`workflow_dispatch`) uruchamianego z `main`, bo tylko `main` ma dostęp do środowiska `agents`. Przekazuje sekret `CLAUDE_CODE_OAUTH_TOKEN` po nazwie i, gdy polecenia różnią się od domyślnych dla npm, wejście `config` z własnym `.sdlc-agents.yml`. Próba potwierdza token i polecenia hooków bez zużycia przebiegu.

## 7. Etykiety i CODEOWNERS

Etykiety (**Issues → Labels**), pod nazwami z `labels` w `.sdlc-agents.yml`, jeśli repozytorium je zmienia:

| Etykieta | Znaczenie |
|---|---|
| `agent:ready` | Issue gotowe do przejęcia przez pipeline |
| `plan:approved` | Człowiek zaakceptował plan zmiany high-impact |
| `needs-human` | Przebieg czeka na decyzję człowieka |
| `agent:stop` | Zatrzymuje przebieg (nazwa stała) |

Przebieg startuje tylko etykieta dodana przez użytkownika z co najmniej uprawnieniem triage, a komentarze liczą się tylko od użytkowników z prawem zapisu (FR-4.23, SEC-8.6).

Plik `.github/CODEOWNERS` wskazuje ludzi, którzy zatwierdzają PR agenta, np. `* @<właściciel>`. Autorem PR agenta jest GitHub App, więc code owner może go zatwierdzić.

## 8. Rulesety ochrony `main`

Trzy rulesety (**Settings → Rules → Rulesets**), każdy z celem „Default branch” i stanem **Active** (rozdz. 2.2 i 3.6 planu):

1. **`gates`**, bez listy obejść:
   - Restrict deletions i Block force pushes;
   - Require a pull request before merging, bez wymaganych approvali;
   - Require status checks to pass z „Require branches to be up to date before merging”. Każdy check ma źródło **GitHub Actions**: `gates / config`, `gates / format`, `gates / lint`, `gates / build`, `gates / test`, `gates / coverage`, `gates / duplication`, `gates / secrets`, `gates / commitlint`, `gates / dependency-review`, `gates / sast-head (<język>)` i `gates / sast-base (<język>)` dla każdego języka z `codeql-languages`, `gates / sast` oraz `scope / scope`;
   - Require code scanning results: CodeQL, „Security alerts” od „High or higher”, „Alerts” od „Errors”.

   Wymagane są też `config`, `build`, `coverage` i joby CodeQL: job pominięty po niezaliczonej zależności ma stan `skipped`, a wymagany check w tym stanie przechodzi (README, „Bramki”).
2. **`approval`**: Require a pull request before merging z jednym approvalem, „Require review from Code Owners”, „Dismiss stale pull request approvals when new commits are pushed” i „Require approval of the most recent reviewable push”. Lista obejść: rola **Repository admin** w trybie „For pull requests only”.
3. **`agent-review`**: Require status checks to pass z checkiem `agent-review` o źródle równym GitHub App pipeline'u. Lista obejść jak w `approval`.

Obejście `approval` i `agent-review` przez administratora pozwala zmergować PR spoza pipeline'u, ale nie zwalnia z bramek. Przy jednym code ownerze to świadome odstępstwo od FR-6.3 (rozdz. 8 planu). Tożsamości pipeline'u nie ma na żadnej liście obejść, a joby bramek nie mają `checks: write` ani `statuses: write` (QG-7.14).

Źródło checku da się wybrać dopiero, gdy check raz się pojawił, więc ruleset `gates` najlepiej utworzyć po pierwszym PR z cienkimi workflow, a `agent-review` po pierwszym review agenta. Do tego czasu ochronę daje sam wymóg PR.

## 9. Sprawdzenie po podłączeniu

1. PR z cienkimi workflow przechodzi wszystkie joby bramek, a w logu post-stepu harden-runnera nie ma wpisu `domain not allowed`.
2. Issue z etykietą `agent:ready` dostaje komentarz ze stanem od GitHub App i plan od Plannera.
3. `agent:stop` dodane w trakcie joba roli przerywa run i publikuje w issue jedno podsumowanie zatrzymania.
4. Komentarz użytkownika bez prawa zapisu nie uruchamia żadnej roli.
5. Workflow bez środowiska `agents` nie widzi `CLAUDE_CODE_OAUTH_TOKEN`.

Wyłącznik globalny to procedura ręczna: wyłączyć workflow Orchestrate w **Actions** i dodać `agent:stop` do issue każdego aktywnego przebiegu. `stop.yml` musi zostać włączony (rozdz. 2.2 planu, FR-4.34).
