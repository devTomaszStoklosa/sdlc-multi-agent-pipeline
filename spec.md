# Specyfikacja: Wieloagentowy pipeline SDLC

**Autor:** T. Stokłosa
**Status:** Szkic
**Data:** 2026-10-27
**Intencja:** [intent.md](intent.md)

---

## 1. Podsumowanie

### 1.1 Problem

Ręczne etapy wytwarzania oprogramowania (planowanie, kodowanie, code review, wdrożenie) zabierają dużo czasu, są podatne na błędy ludzi i spowalniają wydania.

### 1.2 Oczekiwany rezultat

Pipeline wyspecjalizowanych agentów AI (Orchestrator, Planner, Developer, Reviewer, DevOps) przejmuje GitHub Issue, które człowiek oznaczył jako gotowe. Zamienia je w pull request, który przeszedł wszystkie automatyczne bramki i pętlę review agenta. Wdraża ten branch na środowisko dev i prosi programistę o finalną akceptację. Merge i każde wdrożenie poza dev zostają w rękach ludzi.

### 1.3 Kluczowe decyzje

| Temat | Decyzja |
|---|---|
| Autonomia w v1 | Agenci otwierają PR i wdrażają branch PR na dev przed merge. Agenci nigdy nie mergują. Staging i produkcja są poza zasięgiem agentów. |
| Platforma | Repozytoria GitHub, GitHub Actions jako CI, GitHub Issues jako źródło zadań. |
| Intake | Człowiek oznacza issue etykietą `agent:ready`. Agenci nigdy nie biorą issue bez etykiety. |
| Review | Agent Reviewer recenzuje w pętli do 3 rund, aż zatwierdzi. Dopiero wtedy programista dostaje prośbę o finalną akceptację. |
| Zabezpieczenia | Wymuszane w kodzie przez hooki (wywołania narzędzi agenta, git, zdarzenia GitHuba), bramki CI i branch protection. Nigdy nie polegamy wyłącznie na promptach. |
| Zakres | Każdy PR zawiera tylko to, czego wymaga jego issue. Dodatkowe zmiany to znaleziska blokujące, a problemy zauważone po drodze trafiają do osobnych issue. |
| Stack | Niezależny od stacku. Każde repozytorium podaje swoje narzędzia w pliku konfiguracyjnym. |
| Framework | Wymagania są neutralne wobec frameworka. Sekcja 13 porównuje kandydatów i daje wstępną rekomendację, którą potwierdzi spike. |

### 1.4 Powiązanie z intencją

| Punkt intencji | Gdzie omówiony |
|---|---|
| Bezpieczeństwo i kontrola dostępu, brak danych uwierzytelniających w kodzie | Sekcje 8, 9 |
| Jakość kodu i bramki (analiza statyczna, skany bezpieczeństwa, testy przed wdrożeniem) | Sekcje 7, 9, 12 |
| Człowiek w pętli dla działań krytycznych | Sekcje 4, 6 |
| Zgodność z zasadami programowania (SOLID, DRY, KISS, YAGNI, prawo Demeter) | Sekcja 7.3 |
| Otwarte pytanie 1: poziom autonomii | Sekcja 1.3 i sekcja 2 |
| Otwarte pytanie 2: framework agentowy | Sekcja 13 |

### 1.5 Terminy

- **Przebieg (run):** przetwarzanie jednego issue, od etykiety `agent:ready` do zmergowania lub zamknięcia PR albo zatrzymania przebiegu. Po zatrzymaniu issue może mieć kolejny przebieg (FR-4.28b).
- **Etap (stage):** jeden krok przebiegu (np. planowanie, implementacja, review).
- **Bramka (gate):** automatyczne sprawdzenie, które musi przejść (np. testy, SAST, bramka zakresu).
- **Runda (round):** jedno review diffu przez Reviewera plus poprawki Developera, które po nim następują.
- **Znalezisko (finding):** problem zgłoszony przez Reviewera lub bramkę. Jest **blokujące** (trzeba je naprawić przed zatwierdzeniem) albo **nieblokujące** (pokazywane człowiekowi).
- **Plan:** opis zmiany przygotowany przez Plannera, razem z listą plików, które mają się zmienić.
- **Zmiana high-impact:** zmiana, której plan wymaga akceptacji człowieka, zanim powstanie jakikolwiek kod (sekcja 6.1).
- **Wyjątek (waiver):** decyzja człowieka o zaakceptowaniu niezaliczonej bramki, zapisana w PR.
- **Obejście (bypass):** merge PR bez zaliczonego checku `agent-review`, wykonany przez człowieka z listy obejść (FR-6.3). Nie jest wyjątkiem, bo nie dotyczy bramek z sekcji 7.
- **Eskalacja:** przebieg przechodzi w stan `needs-human`, a agenci przestają nad nim pracować, dopóki człowiek nie zadziała.
- **Zatrzymanie:** przejście przebiegu do końcowego stanu `stopped` po dodaniu `agent:stop` albo włączeniu wyłącznika globalnego (FR-4.28, FR-4.34). Słowo „zatrzymać” oznacza w tej specyfikacji wyłącznie to przejście; przejście do `needs-human` to eskalacja.
- **Wyłącznik globalny:** przełącznik dla repozytorium albo organizacji, który zatrzymuje wszystkie przebiegi w swoim zakresie i blokuje start nowych (FR-4.34).

### 1.6 Słowa kluczowe wymagań i identyfikatory

Słowa MUSI, NIE MOŻE, POWINIEN i MOŻE (w odpowiedniej formie) mają znaczenie takie jak MUST, MUST NOT, SHOULD i MAY w RFC 2119. Identyfikatory wymagań zawierają numer sekcji, w której zostały zdefiniowane:

- `FR-` wymagania funkcjonalne
- `NFR-` wymagania niefunkcjonalne
- `SEC-` wymagania bezpieczeństwa
- `QG-` bramki jakości
- `M-` metryki
- `US-` historyjki użytkownika

---

## 2. Cele i nie-cele

### 2.1 Cele

1. Zamienić oznaczone issue w PR, który przechodzi wszystkie bramki i review agenta, jest wdrożony na dev i gotowy do finalnej akceptacji człowieka.
2. Wymuszać zabezpieczenia bezpieczeństwa i jakości deterministycznie, tak by agent nie miał jak ich obejść.
3. Zostawić ludziom kontrolę nad akceptacją planu zmian high-impact, nad merge i nad wszystkim poza dev.
4. Działać na dowolnym repozytorium GitHub przez plik konfiguracyjny, niezależnie od stacku technologicznego.
5. Uczynić wartość i ryzyko mierzalnymi za pomocą wskaźników wyprzedzających i opóźnionych, porównywanych z linią bazową procesu wyłącznie ludzkiego.

### 2.2 Nie-cele v1

- Agenci nie wdrażają na staging ani na produkcję.
- Agenci nie mergują PR i nie włączają auto-merge.
- Jeden przebieg nie zmienia więcej niż jednego repozytorium.
- Pipeline nie zastępuje review człowieka. Finalna akceptacja zawsze należy do człowieka.

---

## 3. Użytkownicy i przypadki użycia

| Rola | Co robi z pipeline'em |
|---|---|
| Product Owner | Pisze issue z kryteriami akceptacji i oznacza je `agent:ready`. Potwierdza, że dostarczona zmiana spełnia kryteria. |
| Tech Lead | Oznacza issue, akceptuje plany zmian high-impact, ustawia progi w konfiguracji repozytorium, śledzi metryki. |
| Programista | Recenzuje PR agentów, komentuje je, zatwierdza i merguje, w razie potrzeby zatrzymuje przebiegi. |
| Inżynier DevOps | Podłącza repozytoria, prowadzi infrastrukturę pipeline'u (runnery, GitHub App, sekrety, środowisko dev), śledzi niezawodność i koszt. |

Historyjki użytkownika:

- **US-1** Jako Product Owner oznaczam dobrze opisane issue etykietą `agent:ready`, żeby zostało zrealizowane bez czekania na wolne moce programistów.
- **US-2** Jako Product Owner widzę, które kryteria akceptacji pokrywa PR, żeby szybko potwierdzić dostawę.
- **US-3** Jako Tech Lead akceptuję plan zmiany high-impact, zanim powstanie jakikolwiek kod, żeby ryzykowne zmiany szły według projektu, na który się zgodziłem.
- **US-4** Jako Tech Lead ustawiam progi bramek i limity dla każdego repozytorium, żeby pipeline pasował do bazy kodu.
- **US-5** Jako programista dostaję PR, który przeszedł wszystkie bramki i review agenta, z linkiem do działającej zmiany na dev, żeby czas review poświęcić na ocenę, a nie na podstawy.
- **US-6** Jako programista komentuję PR, a agent odpowiada w wątku i działa tam, gdzie trzeba, żebym nie musiał go pilnować.
- **US-7** Jako programista w każdej chwili zatrzymuję przebieg etykietą `agent:stop`, żeby zachować kontrolę.
- **US-8** Jako inżynier DevOps podłączam repozytorium przez dodanie jednego pliku konfiguracyjnego i instalację GitHub App, żeby podłączanie było powtarzalne.
- **US-9** Jako inżynier DevOps widzę ślad audytowy i koszt każdego przebiegu, żeby móc wyjaśnić, co zrobili agenci i ile to kosztowało.
- **US-10** Jako dowolny użytkownik widzę metryki porównujące pracę agentów z linią bazową ludzi, żeby podjąć decyzję o rozszerzeniu pipeline'u.

---

## 4. Przebieg pipeline'u

### 4.1 Stany

| Stan | Znaczenie |
|---|---|
| `queued` | Issue ma etykietę `agent:ready` i czeka na wolną przepustowość. |
| `planning` | Planner pisze lub poprawia plan. |
| `awaiting-plan-approval` | Plan zmiany high-impact czeka na decyzję człowieka. |
| `developing` | Developer implementuje zmianę lub naprawia znaleziska. |
| `gating` | Na ostatnim pushu trwają bramki automatyczne. |
| `reviewing` | Reviewer recenzuje diff. |
| `deploying-dev` | Agent DevOps wdraża branch PR na dev. |
| `awaiting-human-review` | PR jest gotowy, a człowiek został poproszony o review. |
| `handling-comments` | Orchestrator przetwarza komentarze człowieka. |
| `needs-human` | Przebieg jest zeskalowany do człowieka. Agenci nic nie robią, dopóki człowiek nie zadziała. |
| `stopped` | Człowiek dodał `agent:stop` albo włączył wyłącznik globalny (FR-4.34). |
| `done` | Człowiek zmergował lub zamknął PR przebiegu (FR-4.35). |

Stany `stopped` i `done` są końcowe. Wszystkie pozostałe stany są **aktywne**. Wśród nich `queued`, `awaiting-plan-approval`, `awaiting-human-review` i `needs-human` to **stany oczekiwania**, w których żaden agent nie pracuje. Pozostałe stany aktywne to **stany pracy**.

### 4.2 Przejścia między stanami

| Z | Zdarzenie | Do |
|---|---|---|
| (brak aktywnego przebiegu) | Uprawniony użytkownik dodaje `agent:ready` do issue, ani issue, ani jego otwarty PR nie mają `agent:stop`, a wyłącznik globalny (FR-4.34) jest wyłączony | `queued` (nowy przebieg) |
| `queued` | Jest wolna przepustowość | `planning` |
| `planning` | Plan opublikowany, zmiana nie jest high-impact | `developing` |
| `planning` | Plan opublikowany, zmiana jest high-impact | `awaiting-plan-approval` |
| `awaiting-plan-approval` | Człowiek akceptuje plan | `developing` |
| `awaiting-plan-approval` | Człowiek żąda zmian w planie | `planning` |
| `developing` | Developer wypycha commit | `gating` |
| `developing` | Developer aktualizuje plan, a nowa wersja jest high-impact (FR-4.11) | `awaiting-plan-approval` |
| `gating` | Dowolna bramka nie przechodzi | `developing` (bez zużycia rundy review) |
| `gating` | Wszystkie bramki przechodzą | `reviewing` |
| `reviewing` | Werdykt `changes_requested`, limity nieprzekroczone | `developing` |
| `reviewing` | Werdykt `approve` | `deploying-dev` |
| `reviewing` | Osiągnięto limit rund albo to samo znalezisko blokujące zgłoszono drugi raz | `needs-human` |
| `deploying-dev` | Wdrożenie i health check się udają | `awaiting-human-review` |
| `deploying-dev` | Wdrożenie nie udaje się po wyczerpaniu budżetu ponowień | `needs-human` |
| `awaiting-human-review` | Człowiek wysyła review albo dodaje komentarz | `handling-comments` |
| `handling-comments` | Potrzebne są tylko odpowiedzi, bez zmiany kodu | `awaiting-human-review` |
| `handling-comments` | Potrzebna jest zmiana kodu | `developing` |
| dowolny stan aktywny | Człowiek zmergował lub zamknął PR przebiegu (FR-4.35) | `done` |
| dowolny stan aktywny | Człowiek dodaje `agent:stop` albo włącza wyłącznik globalny (FR-4.34) | `stopped` |
| dowolny stan pracy | Wyczerpany budżet ponowień etapu albo osiągnięty limit kosztu lub czasu | `needs-human` |
| `needs-human` | Człowiek usuwa etykietę `needs-human` | stan sprzed eskalacji |

Ze stanów `stopped` i `done` nie ma przejść. Dalszą pracę nad issue rozpoczyna nowy przebieg (FR-4.28b).

### 4.3 Intake i planowanie

- **FR-4.1** Przebieg MUSI startować wyłącznie po dodaniu etykiety `agent:ready` do issue przez użytkownika z co najmniej uprawnieniem triage. Pipeline NIE MOŻE brać issue bez tej etykiety.
- **FR-4.2** Issue MUSI mieć co najwyżej jeden aktywny przebieg naraz.
- **FR-4.3** Planner MUSI opublikować plan jako komentarz do issue. Komentarz zawiera:
  - podsumowanie zmiany i wybranego podejścia;
  - sposób spełnienia każdego kryterium akceptacji;
  - listę plików, które mają się zmienić, z jednym zdaniem przy każdym: co i dlaczego, w bloku czytelnym dla maszyny;
  - podejście do testów;
  - klasyfikację high-impact wraz z uzasadnieniem.
- **FR-4.4** Planner MUSI sklasyfikować zmianę według kryteriów high-impact (FR-6.1). Plan high-impact przenosi przebieg do `awaiting-plan-approval`. Każdy inny plan jest publikowany dla wglądu, a przebieg toczy się dalej bez czekania.
- **FR-4.5** Człowiek akceptuje plan etykietą `plan:approved` albo żąda zmian w komentarzu. Żądanie zmian odsyła plan do Plannera.
  - Akceptacją jest wyłącznie dodanie etykiety, gdy przebieg jest w `awaiting-plan-approval`. Akceptacja dotyczy ostatniej opublikowanej wersji planu, a magazyn stanu zapisuje numer tej wersji, autora etykiety i czas (FR-4.6). Etykieta dodana w innym stanie nie jest akceptacją.
  - Zanim pipeline opublikuje wersję planu, która wymaga akceptacji (FR-4.4, FR-4.11), MUSI zdjąć z issue etykietę `plan:approved`, jeśli tam jest. Etykieta z wcześniejszej akceptacji nie przechodzi więc na nową wersję, a człowiek akceptuje nową wersję zwykłym dodaniem etykiety, bo GitHub wysyła zdarzenie tylko wtedy, gdy etykiety jeszcze nie było.
- **FR-4.6** Każda wersja planu MUSI być zachowana. Bramki i Reviewer MUSZĄ używać ostatniej zaakceptowanej wersji dla zmian high-impact, a w pozostałych przypadkach ostatniej opublikowanej.

### 4.4 Implementacja i bramki automatyczne

- **FR-4.7** Developer MUSI pracować na branchu o nazwie `<typ>/<numer-issue>-<krótki-opis>`, utworzonym z aktualnego głównego brancha. `<typ>` jest zgodny z Conventional Commits (`feat`, `fix`, `refactor`, `docs`, `chore`).
- **FR-4.8** Developer MUSI otworzyć draft PR po pierwszym pushu. Opis PR zawiera `Closes #<numer-issue>`.
- **FR-4.9** Komunikaty commitów MUSZĄ być zgodne z Conventional Commits i odwoływać się do issue. Wymusza to hook `commit-msg` (QG-9.14).
- **FR-4.10** Gdy Developer zauważy problem poza zakresem issue, MUSI otworzyć osobne issue i NIE MOŻE naprawiać tego problemu w tym PR. Opis PR wymienia te issue.
- **FR-4.11** Gdy potrzebna jest zmiana poza planem (np. poprawa miejsc wywołania po zmianie sygnatury), Developer MUSI najpierw zaktualizować plan, podając powód. Jeśli zaktualizowany plan spełnia kryteria high-impact, przebieg przechodzi do `awaiting-plan-approval` i czeka na akceptację nowej wersji (FR-4.5).
- **FR-4.12** Każdy push MUSI uruchamiać bramki automatyczne (sekcja 7). Niezaliczona bramka odsyła swój wynik do Developera i nie zużywa rundy review.

### 4.5 Pętla review

- **FR-4.13** Gdy wszystkie bramki przechodzą, Reviewer MUSI przejrzeć cały diff względem głównego brancha, a nie tylko ostatnie commity. Sprawdza diff pod kątem issue, planu i checklisty jakości (sekcja 7.3) oraz sprawdza zakres zmian (QG-7.10).
- **FR-4.14** Reviewer MUSI zwrócić werdykt `approve` albo `changes_requested`. Każde znalezisko ma:
  - stabilny identyfikator znaleziska;
  - wagę: blokujące albo nieblokujące;
  - plik i linię;
  - naruszoną regułę;
  - opis i sugerowaną poprawkę.

  Werdykt jest publikowany jako check run `agent-review`, a znaleziska jako komentarze review w PR.
- **FR-4.15** Przy `changes_requested` Developer MUSI zająć się każdym znaleziskiem blokującym. Jeśli Developer uważa znalezisko za błędne, odpowiada w wątku, podając uzasadnienie, zamiast zmieniać kod. Jeśli Reviewer zgłosi to samo znalezisko ponownie, FR-4.18 eskaluje przebieg.
- **FR-4.16** W każdej rundzie po pierwszej Reviewer MUSI ponownie przejrzeć cały diff i sprawdzić, czy każde wcześniejsze znalezisko zostało rozwiązane.
- **FR-4.17** Pętla kończy się werdyktem `approve`, gdy nie ma otwartego znaleziska blokującego. Otwarte znaleziska nieblokujące są wypisane w opisie PR.
- **FR-4.18** Pętla MUSI się zakończyć eskalacją przebiegu do `needs-human`, gdy:
  - osiągnięto skonfigurowany limit rund (domyślnie 3, ustawiany przez `review.max_rounds`); albo
  - to samo znalezisko blokujące (ta sama reguła w tym samym miejscu kodu, rozpoznawane po identyfikatorze znaleziska) zgłoszono drugi raz.

  Komentarz eskalacyjny podsumowuje otwarte znaleziska.

### 4.6 Wdrożenie na dev i prośba o finalną akceptację

- **FR-4.19** Po `approve` agent DevOps MUSI wdrożyć końcówkę (head) brancha PR na dev skonfigurowanym poleceniem. Wdrożenie uznaje się za udane, gdy przechodzi to polecenie oraz health check, jeśli jest skonfigurowany. URL środowiska dev jest publikowany w PR.
- **FR-4.20** Orchestrator MUSI oznaczyć PR jako gotowy do review i poprosić o review osobę przypisaną do issue, a gdy jej nie ma, CODEOWNERS. Opis PR zawiera:
  - co się zmieniło i dlaczego;
  - linki do issue i planu;
  - wyniki bramek;
  - każdą rundę review i znaleziska, które rozwiązała;
  - otwarte znaleziska nieblokujące;
  - URL środowiska dev;
  - issue otwarte dla problemów spoza zakresu.
- **FR-4.21** Gdy po komentarzach człowieka pojawią się nowe commity, zmiana MUSI ponownie przejść bramki, pętlę review i wdrożenie na dev, zanim zostanie wysłana nowa prośba o review.

### 4.7 Obsługa komentarzy człowieka

- **FR-4.22** Następujące zdarzenia GitHuba MUSZĄ uruchamiać obsługę komentarzy w PR zarządzanym przez pipeline:
  - wysłane review PR;
  - komentarz do review dodany poza review;
  - komentarz pod PR.

  Przy wysłanym review Orchestrator obsługuje wszystkie jego komentarze razem. Pojedynczy komentarz poza review jest obsługiwany po krótkim opóźnieniu (domyślnie 60 sekund, ustawiane przez `limits.comment_debounce_seconds`), żeby kilka szybkich komentarzy obsłużyć razem.
- **FR-4.23** Tylko komentarze od użytkowników z prawem zapisu do repozytorium MOGĄ prowadzić do jakiegokolwiek działania. Komentarze od innych użytkowników i od botów, w tym od samego pipeline'u, MUSZĄ być ignorowane (SEC-8.6, SEC-8.7).
- **FR-4.24** Orchestrator MUSI sklasyfikować każdy komentarz i zadziałać według tabeli:

  | Typ komentarza | Działanie | Odpowiedź w tym samym wątku |
  |---|---|---|
  | Pytanie | Bez zmiany kodu | Odpowiedź |
  | Prośba o zmianę | Developer wprowadza zmianę; bramki i pętla review działają na nowych commitach | Co się zmieniło, z linkiem do commita |
  | Prośba, z którą agent się nie zgadza | Bez zmiany kodu; decyduje człowiek | Uzasadnienie agenta |
  | Prośba spoza zakresu issue | Bez zmiany kodu; zakładane jest osobne issue | Informacja, że prośba wykracza poza zakres, z linkiem do nowego issue |
  | Niejasny komentarz | Bez zmiany kodu | Jedno pytanie doprecyzowujące |

- **FR-4.25** Agenci MUSZĄ odpowiadać w wątku komentarza. NIE MOGĄ oznaczać wątków jako rozwiązanych, bo to osoba, która pytała, decyduje, czy jej komentarz został załatwiony. NIE MOGĄ też odrzucać (dismiss) review człowieka.
- **FR-4.26** Po zadziałaniu na partię komentarzy Orchestrator MUSI ponownie poprosić człowieka o review, dołączając podsumowanie każdego komentarza i tego, co z nim zrobiono.
- **FR-4.27** Każda partia komentarzy człowieka, która prowadzi do zmian w kodzie, MUSI uruchamiać nową pętlę review z tym samym limitem rund.

### 4.8 Kontrola przebiegu

- **FR-4.28** Dodanie `agent:stop` do issue lub PR MUSI natychmiast zatrzymać przebieg w dowolnym stanie aktywnym (sekcja 4.1), czyli w czasie z NFR-4.28d. Działające sesje agentów są kończone, nie następują żadne kolejne pushe ani komentarze (FR-4.28c), a pipeline publikuje podsumowanie (FR-4.28f). Podsumowanie jest jedynym komentarzem zatrzymanego przebiegu. Zatrzymany przebieg pozostaje zatrzymany: nie wznawia go zdjęcie etykiety `agent:stop` lub `needs-human` ani zamknięcie lub merge PR. Gdy człowiek zmerguje lub zamknie PR po zatrzymaniu, pipeline tylko zapisuje to zdarzenie w logu z identyfikatorem przebiegu (NFR-11.3). Ponowne uruchomienie opisuje FR-4.28b.
- **FR-4.28a** Przy zatrzymaniu pipeline MUSI:
  - zdjąć z issue etykiety `agent:ready` i `plan:approved`, żeby ponowne dodanie `agent:ready` wysłało zdarzenie GitHuba, a akceptacja planu nie przeszła na kolejny przebieg;
  - zakończyć check run `agent-review`, który jest w toku, z wynikiem `cancelled` i linkiem do podsumowania (FR-4.28f). Merge wymaga wtedy obejścia `agent-review` przez człowieka (FR-6.3);
  - porzucić zaplanowane działania przebiegu: obsługę komentarzy po opóźnieniu (FR-4.22) i ponowienia etapu (FR-4.30);
  - zwolnić blokadę współdzielonego środowiska dev, jeśli przebieg ją trzyma (OQ-2).

  Pipeline nie zmienia przy tym PR (stanu draftu ani próśb o review), nie anuluje trwających bramek CI i nie cofa commitów. Wyniki bramek, które zakończą się po zatrzymaniu, nie zmieniają stanu przebiegu. Przerwane wdrożenie na dev nie jest wycofywane, a podsumowanie informuje, że środowisko dev może być w niespójnym stanie.
- **FR-4.28b** Nowy przebieg po zatrzymaniu rozpoczyna dodanie `agent:ready` (FR-4.1), gdy ani issue, ani jego otwarty PR nie mają `agent:stop`. Etykietę `agent:stop` zdejmuje wyłącznie człowiek (SEC-9.8), a samo jej zdjęcie nie rozpoczyna przebiegu.
  - Dodanie `agent:ready`, gdy issue lub jego otwarty PR ma `agent:stop`, NIE MOŻE rozpocząć przebiegu. Pipeline zdejmuje wtedy dodaną etykietę `agent:ready` i publikuje w issue komentarz, że najpierw trzeba zdjąć `agent:stop`. Pipeline rozstrzyga na podstawie etykiet w chwili obsługi zdarzenia, a nie kolejności zdarzeń, więc issue z obiema etykietami nie ma aktywnego przebiegu.
  - Nowy przebieg zaczyna od `queued` i `planning`. Planner dostaje poprzednie wersje planu, podsumowanie zatrzymania, komentarze dodane od zatrzymania oraz diff brancha względem głównego brancha. Akceptacja planu z poprzedniego przebiegu nie przechodzi na nowy przebieg, więc plan high-impact czeka na nowe `plan:approved` (FR-4.6).
  - Nowy przebieg ma nowe budżety: limit rund review (FR-4.18), ponowień etapu (FR-4.30) oraz kosztu i czasu (NFR-11.5). Metryki liczone na issue lub PR obejmują wszystkie jego przebiegi (sekcja 14.1).
  - Jeśli issue ma otwarty PR utworzony przez pipeline, nowy przebieg kontynuuje pracę na jego branchu. Commity poprzedniego przebiegu i commity dodane przez człowieka są częścią zmiany: Planner uwzględnia je w planie, a bramki i Reviewer oceniają cały diff (FR-4.13). Zbędne zmiany Developer cofa nowymi commitami. Jeśli branch jest za głównym branchem, Developer na początku implementacji MUSI scalić do niego aktualny główny branch commitem merge z komunikatem zgodnym z FR-4.9. Rebase i force-push są zabronione (SEC-9.2, SEC-9.5).
  - Jeśli issue nie ma otwartego PR, bo człowiek zamknął PR albo usunął jego branch, nowy przebieg zaczyna od zera: tworzy nowy branch z aktualnego głównego brancha (FR-4.7) i nowy draft PR, który linkuje poprzedni. Nazwa nowego brancha MUSI różnić się od nazw istniejących branchy. Zamknięcie PR jest więc sposobem na rozpoczęcie pracy od zera.
- **FR-4.28c** Przed każdym skutkiem ubocznym przebiegu pipeline MUSI sprawdzić, czy przebieg jest nadal aktywny. Skutki uboczne to commit, push, komentarz, zmiana issue lub PR (w tym etykiet i próśb o review), check run, utworzenie issue i wdrożenie na dev. Przebieg jest aktywny, gdy ani issue, ani jego PR nie ma `agent:stop`, wyłącznik globalny (FR-4.34) nie jest włączony, PR przebiegu (FR-4.35), jeśli istnieje, nie jest zamknięty ani zmergowany, a magazyn stanu wskazuje ten przebieg jako aktywny przebieg issue. Jeśli któryś warunek nie jest spełniony, działanie NIE MOŻE się odbyć.
  - Sprawdzenie odczytuje etykiety, stan PR i stan wyłącznika w chwili działania, a nie ze zdarzenia. Sama etykieta nie wystarcza, bo jej zdjęcie nie wznawia zatrzymanego przebiegu (FR-4.28). Sam stan też nie wystarcza, bo jego zapis może się spóźnić albo nie nastąpić, gdy zdarzenie `agent:stop` nie dotrze (FR-4.28e).
  - Reguła obejmuje kod Orchestratora i wywołania narzędzi agentów (SEC-9.8a). Nie obejmuje porządków i podsumowania przy zatrzymaniu (FR-4.28a, FR-4.28f) ani porządków przy zakończeniu przebiegu (FR-4.35).
  - Samo kończenie sesji agentów nie wystarcza, bo anulowany proces dostaje kilka sekund przed zabiciem. Operacja, która przeszła sprawdzenie przed dodaniem etykiety, MOŻE się dokończyć, ale musi się zmieścić w czasie z NFR-4.28d.
- **NFR-4.28d** Zatrzymanie MUSI się zakończyć w ciągu 60 sekund od dodania etykiety `agent:stop` albo włączenia wyłącznika globalnego (FR-4.34) w 95% zatrzymań i w ciągu 5 minut w każdym zatrzymaniu. Zatrzymanie jest zakończone, gdy wszystkie sesje agentów przebiegu się zakończyły i nie trwa żaden jego skutek uboczny (FR-4.28c). Działań samego zatrzymania (FR-4.28a i FR-4.28f) się nie wlicza. Czas liczy się od znacznika czasu dodania etykiety w GitHubie albo włączenia wyłącznika do ostatniego z tych zdarzeń w logu audytowym (NFR-11.1, NFR-11.3).
- **FR-4.28e** Pipeline NIE MOŻE polegać wyłącznie na dostarczeniu zdarzenia `agent:stop`. Zdarzenie może nie dotrzeć, np. gdy nie uda się dostawa webhooka, a GitHub nie ponawia nieudanych dostaw sam. Co najwyżej co 2 minuty pipeline MUSI porównać każdy przebieg w stanie aktywnym z etykietami jego issue i PR oraz ze stanem wyłącznika globalnego (FR-4.34) i zatrzymać (FR-4.28, FR-4.28a) przebieg, którego issue lub PR ma `agent:stop` albo który obejmuje włączony wyłącznik. Zatrzymanie wykryte w ten sposób liczy się jako utracone zdarzenie w M-G04.
- **FR-4.28f** Po zatrzymaniu Orchestrator MUSI opublikować podsumowanie jako jeden komentarz w issue. Podsumowanie zawiera:
  - identyfikator przebiegu;
  - kto zatrzymał przebieg i gdzie: autora etykiety `agent:stop` oraz to, czy dodał ją do issue, czy do PR, albo wyłącznik globalny (FR-4.34) z jego zakresem i osobą, która go włączyła, jeśli pipeline ją zna;
  - znacznik czasu dodania etykiety albo włączenia wyłącznika;
  - stan i etap w chwili zatrzymania oraz numer rundy review, gdy ma to znaczenie;
  - branch, PR i SHA ostatniego wypchniętego commita, jeśli istnieją;
  - otwarte znaleziska blokujące i nieblokujące;
  - przerwane działania: zakończone sesje agentów, porzucone zaplanowane działania (FR-4.28a), operację dokończoną po zatrzymaniu (FR-4.28c), check run `agent-review` zakończony z wynikiem `cancelled` i przerwane wdrożenie na dev;
  - zużyty koszt i czas przebiegu wobec limitów (NFR-11.4, NFR-11.5);
  - sposób rozpoczęcia nowego przebiegu (FR-4.28b) i informację, że merge wymaga obejścia `agent-review` (FR-6.3).

  Orchestrator składa podsumowanie z magazynu stanu i logu zdarzeń, bez wywołania modelu, żeby zatrzymanie nie zależało od dostępności ani kosztu modelu. Każdy zatrzymany przebieg ma dokładnie jedno podsumowanie, także gdy `agent:stop` dodano do issue i do PR, gdy przebieg objął też wyłącznik globalny albo gdy zatrzymanie wykryło też porównanie z FR-4.28e. W PR pipeline nie publikuje osobnego komentarza: PR linkuje issue (FR-4.8), a wynik check runa `agent-review` linkuje podsumowanie (FR-4.28a). Błąd publikacji nie cofa zatrzymania i jest zapisywany w logu zdarzeń (NFR-11.3).
- **FR-4.29** Etapy MUSZĄ być idempotentne i wznawialne. Stan przebiegu jest przechowywany poza sesjami agentów, żeby etap, który się wywrócił, mógł zostać wznowiony bez powtarzania skutków ubocznych.
- **FR-4.30** Etap, który zawiedzie z przyczyn infrastrukturalnych, MUSI być ponawiany do skonfigurowanego budżetu (domyślnie 2, ustawiane przez `limits.stage_retries`). Potem przebieg przechodzi do `needs-human`.
- **FR-4.31** Gdy przebieg osiągnie limit kosztu lub czasu (NFR-11.5), MUSI przejść do `needs-human`.
- **FR-4.32** Gdy człowiek usunie etykietę `needs-human`, przebieg MUSI być kontynuowany od etapu sprzed eskalacji, z nowym budżetem rund. Komentarze dodane w międzyczasie są obsługiwane tak jak w sekcji 4.7.
- **FR-4.33** Pipeline MUSI działać wyłącznie na issue, o które został poproszony, oraz na branchach i PR, które sam utworzył. NIE MOŻE działać na PR z forków.
- **FR-4.34** Pipeline MUSI mieć wyłącznik globalny dla repozytorium i dla organizacji, np. na wypadek incydentu albo nagłego wzrostu kosztów.
  - Włączenie wyłącznika MUSI zatrzymać (FR-4.28 do FR-4.28f) każdy przebieg w stanie aktywnym w jego zakresie, w czasie z NFR-4.28d. Dopóki wyłącznik jest włączony, w jego zakresie nie startuje żaden nowy przebieg. Dodanie `agent:ready` pipeline obsługuje wtedy tak jak przy obecnym `agent:stop` (FR-4.28b): zdejmuje etykietę i publikuje w issue komentarz, że pipeline jest wyłączony.
  - Wyłączenie wyłącznika nie wznawia zatrzymanych przebiegów. Nowy przebieg rozpoczyna dodanie `agent:ready` (FR-4.28b).
  - Wyłącznik włącza i wyłącza wyłącznie człowiek z uprawnieniem administratora repozytorium albo organizacji. Pipeline i agenci NIE MOGĄ mieć uprawnień do jego zmiany.
  - Wyłącznik NIE MOŻE być częścią `.sdlc-agents.yml`, bo jego zmiana wymagałaby PR i merge (FR-10.3), i NIE MOŻE zależeć od konfiguracji repozytorium (FR-10.4) ani od dostępności modelu.
- **FR-4.35** Gdy człowiek zmerguje lub zamknie PR przebiegu, przebieg w dowolnym stanie aktywnym (sekcja 4.1) MUSI przejść do `done`. PR przebiegu to PR, na którego branchu przebieg pracuje: utworzony przez ten przebieg (FR-4.8) albo otwarty PR poprzedniego przebiegu, który ten przebieg kontynuuje (FR-4.28b).
  - Pipeline MUSI zakończyć działające sesje agentów przebiegu w granicach czasu z NFR-4.28d, liczonych od zamknięcia lub merge'u PR, i porzucić zaplanowane działania przebiegu: obsługę komentarzy po opóźnieniu (FR-4.22) i ponowienia etapu (FR-4.30).
  - Po zamknięciu lub merge'u PR przebieg nie ma żadnych skutków ubocznych (FR-4.28c), w tym commitów i pushy na branch PR. Operacja, która przeszła sprawdzenie przed zamknięciem lub merge'em, MOŻE się dokończyć w tych samych granicach czasu.
  - Pipeline MUSI zakończyć check run `agent-review`, który jest w toku, z wynikiem `cancelled` i zwolnić blokadę współdzielonego środowiska dev, jeśli przebieg ją trzyma (OQ-2). Nie zmienia przy tym PR ani brancha, nie anuluje trwających bramek CI, nie cofa commitów i nie wycofuje przerwanego wdrożenia na dev.
  - Pipeline MUSI zdjąć z issue etykiety `agent:ready` i `plan:approved`, także po merge'u PR, pod nazwami zapisanymi w magazynie stanu przy starcie przebiegu (FR-10.4). Ponowne dodanie `agent:ready` wysyła wtedy zdarzenie GitHuba i rozpoczyna nowy przebieg (FR-4.28b), a akceptacja planu nie przechodzi na kolejny przebieg.
  - Pipeline nie publikuje komentarza o zakończeniu. Zapisuje je w logu zdarzeń (NFR-11.3) ze stanem i etapem w chwili zamknięcia lub merge'u PR oraz z przerwanymi działaniami.
  - Zamknięcie lub merge PR zatrzymanego przebiegu nie zmienia jego stanu (FR-4.28).
- **FR-4.36** Pipeline NIE MOŻE polegać wyłącznie na dostarczeniu pozostałych zdarzeń z tabeli w sekcji 9.4, bo zdarzenie może nie dotrzeć tak samo jak `agent:stop` (FR-4.28e). Co najwyżej co 10 minut pipeline MUSI porównać każdy przebieg w stanie aktywnym z GitHubem i obsłużyć zdarzenie, którego skutek widać w GitHubie, a którego przebieg nie obsłużył:
  - etykietę `plan:approved` dodaną, gdy przebieg jest w `awaiting-plan-approval` (FR-4.5);
  - brak etykiety `needs-human`, gdy przebieg jest w `needs-human` (FR-4.32);
  - komentarz do issue, wysłane review albo komentarz w PR od użytkownika z prawem zapisu, dodane po ostatnim obsłużonym (FR-4.22, FR-4.23);
  - zakończony workflow bramek dla ostatniego pushu, gdy przebieg jest w `gating` (FR-4.12);
  - zamknięty albo zmergowany PR przebiegu (FR-4.35).

  Pipeline MUSI też wykryć issue z etykietą `agent:ready` bez aktywnego przebiegu i obsłużyć je tak jak dodanie tej etykiety (FR-4.1, FR-4.28b, FR-4.34), sprawdzając uprawnienia osoby, która ją dodała, w historii zdarzeń issue. Obsługa jest idempotentna (FR-4.29): zdarzenie, które dotrze po porównaniu, nie zmienia stanu drugi raz. Każde zdarzenie wykryte w ten sposób liczy się jako utracone zdarzenie w M-G04. Porównanie MOŻE działać w tym samym procesie co porównanie z FR-4.28e. Okres jest dłuższy niż w FR-4.28e, bo te zdarzenia nie dotyczą bezpieczeństwa, a każde porównanie zużywa limit zapytań do API GitHuba.

---

## 5. Agenci

| Agent | Odpowiedzialność | Wejścia | Wyjścia | Narzędzia |
|---|---|---|---|---|
| Orchestrator | Steruje maszyną stanów, przydziela pracę, klasyfikuje komentarze człowieka, pilnuje limitów | Zdarzenia GitHuba, stan przebiegu | Zmiany stanu, prośby o review, opis PR, podsumowania | GitHub API (etykiety, stan PR, prośby o review, komentarze, zakończenie check runa `agent-review` przy zatrzymaniu), anulowanie sesji agentów przy zatrzymaniu, magazyn stanu przebiegów, wywołanie modelu do klasyfikacji komentarzy |
| Planner | Pisze plan i klasyfikuje zmiany high-impact | Issue, zawartość repozytorium | Komentarz z planem | Odczyt i przeszukiwanie repozytorium, komentowanie issue |
| Developer | Implementuje zmianę, naprawia znaleziska, działa na prośby o zmianę, otwiera issue spoza zakresu, aktualizuje plan | Issue, plan, znaleziska, komentarze | Commity na branchu issue, draft PR, odpowiedzi, nowe issue | Odczyt i zapis plików w przestrzeni roboczej, uruchamianie skonfigurowanych poleceń, commit i push na branch issue, komentowanie, tworzenie issue |
| Reviewer | Recenzuje diff, sprawdza zakres i jakość, zwraca werdykt | Issue, plan, diff, wyniki bramek, wcześniejsze znaleziska | Check run `agent-review`, komentarze review | Odczyt i przeszukiwanie repozytorium, odczyt diffu i wyników bramek, publikowanie komentarzy review i check runa |
| DevOps | Wdraża branch PR na dev | Branch PR, konfiguracja repozytorium | Wdrożenie, URL dev, logi wdrożenia | Uruchamianie skonfigurowanych poleceń wdrożenia na dev i health checku, komentowanie PR |

Zakresy tokenów dla każdego agenta (uprawnienia GitHub App, SEC-8.1):

| Agent | Contents | Pull requests | Issues | Checks | Inne |
|---|---|---|---|---|---|
| Orchestrator | odczyt | zapis | zapis | zapis (tylko zakończenie `agent-review` przy zatrzymaniu i zakończeniu przebiegu, FR-4.28a, FR-4.35) | Actions: zapis (tylko anulowanie runów przebiegu przy zatrzymaniu i zakończeniu przebiegu, FR-4.28, FR-4.35), gdy sesje agentów działają na runnerach GitHub Actions |
| Planner | odczyt | brak | zapis (komentarze) | brak | brak |
| Developer | zapis (tylko niechronione branche) | zapis | zapis | odczyt | brak |
| Reviewer | odczyt | zapis (tylko komentarze; zatwierdzanie jest zablokowane, SEC-9.7) | brak | zapis (`agent-review`) | brak |
| DevOps | odczyt | zapis (komentarze) | brak | brak | tylko środowisko dev, przez OIDC |

Uprawnienie Actions Orchestratora MOŻE pochodzić z tokenu workflow (`GITHUB_TOKEN`) nadanego tylko jobowi zatrzymania zamiast z GitHub App. To jedyny wyjątek od SEC-8.1, dopuszczony dlatego, że takiego tokenu nie dostaje żaden inny job ani agent.

Wymagania:

- **FR-5.1** Każdy agent MUSI działać we własnej sesji, z własną listą dozwolonych narzędzi i własnymi poświadczeniami. Ról NIE MOŻNA uruchamiać jako sub-agentów jednej drugiej, jeśli środowisko uruchomieniowe sprawia, że sub-agenci dziedziczą uprawnienia rodzica.
- **FR-5.2** Developer NIE MOŻE zatwierdzać własnej pracy. Akceptacja żadnego agenta NIE MOŻE liczyć się do wymogu merge (FR-6.3).
- **FR-5.3** Kontekst Reviewera MUSI być ograniczony do issue, planu, diffu, wyników bramek i wcześniejszych znalezisk. Reviewer NIE MOŻE widzieć transkryptu ani rozumowania Developera, żeby oceniał kod, a nie intencje.
- **FR-5.4** Reviewer MUSI mieć narzędzia tylko do odczytu. Wymusza to hook (SEC-9.7) oraz zakres jego tokenu, a nie tylko prompt.
- **FR-5.5** Reviewer POWINIEN działać na innym modelu niż Developer, żeby ich martwe punkty mniej się pokrywały.
- **FR-5.6** Przepływ sterowania Orchestratora POWINIEN być deterministycznym kodem (maszyna stanów z sekcji 4). Model służy wyłącznie do klasyfikacji komentarzy i pisania podsumowań.
- **FR-5.7** Agent DevOps MUSI mieć poświadczenia wyłącznie do środowiska dev.
- **FR-5.8** Prompty i konfiguracje agentów MUSZĄ być wersjonowane. Każda ich zmiana MUSI przejść bramkę ewaluacji (QG-12.4).

---

## 6. Bramki human-in-the-loop

- **FR-6.1** Zmiana jest high-impact, gdy obejmuje cokolwiek z poniższych:
  - migrację schematu bazy danych;
  - kod uwierzytelniania, autoryzacji lub inny kod związany z bezpieczeństwem;
  - publiczny kontrakt API;
  - pliki CI lub infrastruktury, w tym `.sdlc-agents.yml` i inną konfigurację bramek;
  - nową zależność;
  - więcej plików lub zmienionych linii niż skonfigurowane limity (`high_impact.max_files`, `high_impact.max_changed_lines`);
  - ścieżki wymienione w `high_impact.extra_paths`.

  Człowiek MUSI zaakceptować plan zmiany high-impact, zanim powstanie jakikolwiek kod.
- **FR-6.2** Akceptacja Reviewera MUSI być publikowana jako wymagany status check `agent-review`, nigdy jako approval PR w GitHubie.
- **FR-6.3** Branch protection na głównym branchu MUSI wymagać:
  - wszystkich bramek z sekcji 7 i `agent-review` jako wymaganych status checków;
  - co najmniej jednego approval od człowieka będącego właścicielem kodu (code owner);
  - braku bezpośrednich pushów i braku force-pushów.

  Każdy wymagany status check MUSI mieć przypięte źródło: aplikację, która go wystawia. Źródłem `agent-review` jest wyłącznie tożsamość pipeline'u (FR-6.2). Check ani status o tej samej nazwie z innego źródła NIE MOŻE spełniać wymogu.

  Wymóg `agent-review` MOŻE obejść przy merge PR wyłącznie człowiek z listy obejść, np. przy PR spoza pipeline'u albo PR po zatrzymaniu przebiegu (FR-4.28). Obejście NIE MOŻE zwalniać z bramek z sekcji 7, approvalu code ownera ani zakazu bezpośrednich pushów i force-pushów. Tożsamość pipeline'u NIE MOŻE być na liście obejść ani w inny sposób omijać branch protection.
- **FR-6.4** Prośba o finalną akceptację człowieka MUSI zawsze być ostatnim krokiem przed merge.
- **FR-6.5** Merge może wykonać tylko człowiek. Agenci NIE MOGĄ mergować i NIE MOGĄ włączać auto-merge.
- **FR-6.6** Agenci NIE MOGĄ mieć poświadczeń ani uprawnień do stagingu i produkcji. Środowiska GitHub dla stagingu i produkcji MUSZĄ wymagać recenzentów będących ludźmi.
- **FR-6.7** Wyjątek (waiver) może przyznać tylko człowiek (QG-7.13).

---

## 7. Bramki jakości

### 7.1 Bramki automatyczne

Każda bramka działa w CI przy każdym pushu, na narzędziach wskazanych w konfiguracji repozytorium.

- **QG-7.1** **Analiza statyczna:** brak nowych znalezisk na skonfigurowanym poziomie wagi lub wyższym (`gates.static_analysis_fail_on`).
- **QG-7.2** **SAST:** brak nowych znalezisk na skonfigurowanym poziomie wagi lub wyższym (`gates.sast_fail_on`).
- **QG-7.3** **Skanowanie sekretów:** brak sekretów w diffie.
- **QG-7.4** **Skanowanie zależności:** brak nowych znanych podatności na skonfigurowanym poziomie wagi lub wyższym (`gates.dependency_scan_fail_on`). Nowe zależności czynią też zmianę high-impact (FR-6.1).
- **QG-7.5** **Testy:** wszystkie skonfigurowane testy jednostkowe i integracyjne przechodzą.
- **QG-7.6** **Pokrycie:** pokrycie testami nie spada poniżej poziomu głównego brancha, poza skonfigurowaną tolerancją (`gates.coverage_drop_tolerance`, domyślnie 0).
- **QG-7.7** **Złożoność:** żadna funkcja nie przekracza skonfigurowanego progu złożoności.
- **QG-7.8** **Duplikacja:** duplikacja mieści się w skonfigurowanym progu.

### 7.2 Zakres

- **QG-7.9** **Bramka zakresu (deterministyczna):** CI porównuje pliki zmienione w diffie z listą plików z planu. Każdy zmieniony plik spoza listy to znalezisko blokujące. Zmiany w plikach lockfile są dozwolone tylko wtedy, gdy plan wymienia zmianę zależności.
- **QG-7.10** **Review zakresu:** w obrębie planowanych plików Reviewer wskazuje jako znaleziska blokujące zmiany, których issue nie wymaga. Przykłady:
  - niezwiązany refaktoring lub przeformatowanie;
  - zmiany logiki wykraczające poza zadanie;
  - zmiany zależności lub konfiguracji, których plan nie wymienił;
  - usunięty lub przepisany kod, który nie był częścią zadania.

### 7.3 Zasady programowania

Intencja wymaga ścisłego przestrzegania zasad programowania. Każda zasada jest zamieniona na automatyczne sprawdzenie wszędzie tam, gdzie stack ma na to narzędzie, oraz na pozycję checklisty Reviewera, która jest stosowana zawsze. Niezaliczona pozycja checklisty to znalezisko blokujące, chyba że Reviewer oznaczy je jako nieblokujące, podając powód.

| Zasada | Sprawdzenie automatyczne (tam, gdzie stack je wspiera) | Pozycja checklisty Reviewera |
|---|---|---|
| Jedna odpowiedzialność (SRP) | Progi rozmiaru i złożoności klas i funkcji (QG-7.7) | Każda klasa, moduł lub komponent ma jeden powód do zmiany. Niezwiązana logika nie jest dokładana do istniejącej klasy. |
| Otwarte/zamknięte (OCP) | Reguły wskazujące łańcuchy `switch` lub `if` po typie, jeśli są dostępne | Nowe zachowanie dodawane jest przez nową implementację, a nie przez kolejne sprawdzanie typów w istniejącym kodzie. |
| Podstawialność Liskov (LSP) | Reguły wskazujące wyjątki w stylu `NotImplemented` w nadpisanych metodach | Implementacje działają wszędzie tam, gdzie ich typ bazowy lub interfejs, bez zaostrzania wymagań wstępnych. |
| Segregacja interfejsów (ISP) | Brak w ogólnym przypadku | Interfejsy zawierają tylko metody potrzebne ich klientom. |
| Odwrócenie zależności (DIP) | Reguły wskazujące bezpośrednie tworzenie serwisów w logice biznesowej, jeśli są dostępne | Logika biznesowa dostaje zależności przez wstrzykiwanie. |
| DRY | Próg duplikacji (QG-7.8) | Brak skopiowanej logiki, która powinna być współdzielona. |
| KISS | Próg złożoności (QG-7.7) | Najprostszy projekt, który spełnia wymagania. |
| YAGNI | Wykrywanie nieużywanego kodu | Brak abstrakcji na zapas i nieużywanego kodu, brak interfejsu dla jedynej implementacji, chyba że potrzebują go testy, DI lub granica modułu. |
| Prawo Demeter | Reguły dotyczące długości łańcuchów wywołań, jeśli są dostępne | Kod nie sięga przez łańcuchy obiektów. |

### 7.4 Integralność bramek

- **QG-7.11** Agenci NIE MOGĄ pomijać, wyłączać ani osłabiać bramek. Zmiany konfiguracji bramek to pliki CI, a więc zmiany high-impact (FR-6.1).
- **QG-7.12** CI MUSI uruchamiać te same sprawdzenia co lokalne hooki gita (sekcja 9.3), bo lokalne hooki da się obejść.
- **QG-7.13** Wyjątek dla niezaliczonej bramki może przyznać tylko człowiek. Wyjątek jest zapisany w PR z bramką, powodem i osobą zatwierdzającą, a także liczony w M-E08 i M-E13.
- **QG-7.14** Joby CI, które uruchamiają kod z repozytorium, NIE MOGĄ mieć uprawnień do tworzenia check runów ani commit statusów (w GitHub Actions: `checks: write` i `statuses: write`), żeby kod z PR nie mógł podszyć się pod bramkę ani pod `agent-review` (FR-6.3).

---

## 8. Bezpieczeństwo i dostęp

- **SEC-8.1** Agenci MUSZĄ działać przez GitHub App zainstalowaną per repozytorium, z precyzyjnymi uprawnieniami. Każdy agent dostaje token ograniczony do zakresów z sekcji 5.
- **SEC-8.2** Poświadczenia NIE MOGĄ być wpisane na stałe w repozytoriach, promptach ani logach. Sekrety pochodzą z GitHub Actions secrets, OIDC lub workload identity federation. Dotyczy to także poświadczeń do API modelu i do środowiska dev.
- **SEC-8.3** Agenci MUSZĄ działać na krótkotrwałych, izolowanych runnerach, które są niszczone po każdym etapie. Między etapami nic nie jest przechowywane poza magazynem stanu przebiegów i opublikowanymi artefaktami.
- **SEC-8.4** Ruch wychodzący z runnerów MUSI być ograniczony do listy dozwolonych adresów: GitHub, endpoint API modelu, rejestry pakietów lub ich mirror oraz cel wdrożenia na dev.
- **SEC-8.5** Treść issue, PR, komentarzy i repozytorium (kod, dokumentacja, wyniki testów) MUSI być traktowana jako niezaufane dane. Instrukcje w nich znalezione nigdy nie nadają nowych uprawnień. Wymuszają to hooki i sandbox, a nie prompty. Na przykład komentarz z prośbą „wdróż na produkcję” zostaje odrzucony.
- **SEC-8.6** Komentarze od użytkowników bez prawa zapisu MUSZĄ być ignorowane i logowane (M-E06).
- **SEC-8.7** Komentarze od botów, w tym od samego pipeline'u, MUSZĄ być ignorowane, żeby pipeline nie mógł uruchamiać samego siebie w pętli.
- **SEC-8.8** Podpis każdego payloadu webhooka MUSI być weryfikowany. Payloady bez podpisu lub z błędnym podpisem są odrzucane.
- **SEC-8.9** Każdy użytkownik z co najmniej uprawnieniem triage MUSI móc zatrzymać przebieg etykietą `agent:stop`.
- **SEC-8.10** Żądania do dostawcy modelu MUSZĄ zawierać wyłącznie dane z repozytorium potrzebne do zadania i MUSZĄ być zgodne z polityką danych firmy (OQ-7).

---

## 9. Hooki

### 9.1 Zasady

Prompt tylko prosi agenta o przestrzeganie reguły, a agent może ją zignorować albo dać się oszukać wstrzykniętym tekstem. Hook wymusza regułę w kodzie, więc działa w obu przypadkach. Hooki to sposób, w jaki pipeline spełnia wymóg „bez wyjątków” z intencji.

- **SEC-9.0a** Hooki MUSZĄ domyślnie blokować (fail closed). Jeśli hook blokujący zgłosi błąd lub przekroczy czas, akcja jest blokowana.
- **SEC-9.0b** Organizacja definiuje bazowy zestaw hooków. Repozytorium MOŻE go zaostrzyć, ale NIE MOŻE go osłabić.
- **SEC-9.0c** Hooki NIE MOGĄ być jedyną warstwą. Regułę, którą da się obejść poleceniem powłoki (np. zapis pliku przez polecenie powłoki zamiast narzędzia edycji), MUSI wymuszać także sandbox runnera (SEC-8.3, SEC-8.4). Hooki wywołań narzędzi zwykle dopasowują się do nazwy narzędzia, a nie do tego, co robi polecenie powłoki.

### 9.2 Hooki wywołań narzędzi agenta

Te hooki działają przed każdym wywołaniem narzędzia i po nim oraz wtedy, gdy agent zgłasza zakończenie pracy. Opisano je niezależnie od frameworka; jednym z przykładów są zdarzenia `PreToolUse`, `PostToolUse` i `Stop` w Claude Agent SDK.

Przed wywołaniem narzędzia hook blokuje:

- **SEC-9.1** zapisy poza przestrzenią roboczą repozytorium;
- **SEC-9.2** pushe na chronione branche, pushe na jakikolwiek branch inny niż branch issue danego przebiegu oraz każdy force-push;
- **SEC-9.3** czytanie lub wypisywanie plików z sekretami, takich jak `.env`, klucze prywatne i pliki z poświadczeniami (lista wzorców w bazowym zestawie organizacji);
- **SEC-9.4** połączenia sieciowe spoza listy dozwolonych (SEC-8.4);
- **SEC-9.5** polecenia destrukcyjne, takie jak rekurencyjne usuwanie poza przestrzenią roboczą, przepisywanie historii gita i usuwanie baz danych (lista wzorców w zestawie bazowym);
- **SEC-9.6** `--no-verify` i inne flagi pomijające hooki gita;
- **SEC-9.7** każde narzędzie zapisu lub polecenie powłoki użyte przez Reviewera oraz approval w GitHubie wysłany przez dowolnego agenta;
- **SEC-9.8** działania zarezerwowane dla ludzi:
  - merge lub włączenie auto-merge;
  - odrzucenie review lub oznaczenie wątku jako rozwiązanego;
  - dodanie `plan:approved`, usunięcie `needs-human` lub usunięcie `agent:stop`;
- **SEC-9.8a** każde wywołanie narzędzia ze skutkiem ubocznym (FR-4.28c), gdy przebieg nie jest już aktywny. Hook sprawdza etykiety, stan PR przebiegu (FR-4.35), wyłącznik globalny (FR-4.34) i magazyn stanu w chwili wywołania, a błąd sprawdzenia blokuje wywołanie (SEC-9.0a).

Po wywołaniu narzędzia hook:

- **QG-9.9** uruchamia formatter i linter na edytowanych plikach i od razu odsyła ewentualne błędy do agenta;
- **SEC-9.10** usuwa sekrety z wyniku narzędzia, zanim zobaczy go model i zanim trafi do logów;
- **NFR-9.11** dopisuje wywołanie do logu audytowego: narzędzie, podsumowanie wejścia, decyzję hooka i czas trwania.

Gdy agent zgłasza zakończenie pracy:

- **QG-9.12** hook sprawdza, czy bramki wymagane na tym etapie się uruchomiły i przeszły. Jeśli nie, odrzuca zakończenie i odsyła agenta do pracy. Na przykład Developer nie może zgłosić końca pracy przy niezaliczonych testach.

### 9.3 Hooki gita

- **QG-9.13** Hook `pre-commit` MUSI uruchamiać formatter, linter i skan sekretów.
- **QG-9.14** Hook `commit-msg` MUSI wymuszać Conventional Commits i odwołanie do issue.
- **QG-9.15** Ludzie i agenci MUSZĄ używać tych samych hooków gita. CI uruchamia te same sprawdzenia jeszcze raz (QG-7.12).

### 9.4 Wyzwalacze ze zdarzeń GitHuba

| Zdarzenie | Warunek | Działanie |
|---|---|---|
| Issue oznaczone `agent:ready` | Dodane przez użytkownika z uprawnieniem triage lub wyższym, brak aktywnego przebiegu, ani issue, ani jego otwarty PR nie mają `agent:stop`, a wyłącznik globalny jest wyłączony | Start przebiegu (FR-4.1, FR-4.28b) |
| Issue oznaczone `agent:ready` | Issue lub jego otwarty PR ma `agent:stop` albo wyłącznik globalny jest włączony | Zdjęcie `agent:ready` i komentarz w issue (FR-4.28b, FR-4.34) |
| Issue lub PR oznaczone `agent:stop` | Przebieg jest w stanie aktywnym (sekcja 4.1) | Zatrzymanie przebiegu (FR-4.28, FR-4.28a) |
| Issue oznaczone `plan:approved` | Przebieg jest w `awaiting-plan-approval` | Akceptacja ostatniej opublikowanej wersji planu i przejście do `developing` (FR-4.5) |
| Komentarz do issue | Przebieg jest w `awaiting-plan-approval`, autor ma prawo zapisu | Planner poprawia plan |
| Wysłane review PR | Zarządzany PR, autor ma prawo zapisu | Obsługa wszystkich komentarzy review (FR-4.22) |
| Komentarz do review poza review albo komentarz pod PR | Zarządzany PR, autor ma prawo zapisu | Obsługa po opóźnieniu (FR-4.22) |
| Check run lub check suite zakończony niepowodzeniem | Branch issue danego przebiegu | Przekazanie błędu do Developera (FR-4.12) |
| Z issue zdjęta etykieta `needs-human` | Przebieg jest w `needs-human` | Wznowienie przebiegu (FR-4.32) |
| PR zamknięty lub zmergowany | Zarządzany PR, przebieg jest w stanie aktywnym | Przejście przebiegu do `done` (FR-4.35) |
| PR zamknięty lub zmergowany | Zarządzany PR, przebieg jest w `stopped` | Zapis zdarzenia w logu, bez zmiany stanu (FR-4.28) |

Zdarzenia z tej tabeli, które nie dotarły, wykrywa porównanie przebiegów z GitHubem: `agent:stop` i wyłącznik globalny według FR-4.28e, pozostałe według FR-4.36.

Podpis każdego payloadu jest weryfikowany, a jego treść traktowana jako niezaufana (SEC-8.5, SEC-8.8).

---

## 10. Konfiguracja per repozytorium

- **FR-10.1** Każde podłączone repozytorium MUSI zawierać `.sdlc-agents.yml`. Pipeline waliduje go względem schematu i odmawia działania, jeśli jest niepoprawny. Odmowa nie obejmuje zatrzymania (FR-10.4).
- **FR-10.2** Konfiguracja MOŻE zaostrzać bazowy zestaw organizacji (ostrzejsze progi, więcej zablokowanych ścieżek, więcej ścieżek high-impact). NIE MOŻE go łagodzić. Dodanie hostów do listy dozwolonych połączeń sieciowych jest możliwe wyłącznie przez zmianę bazowego zestawu organizacji.
- **FR-10.3** Zmiany w `.sdlc-agents.yml` są zmianami high-impact (FR-6.1).
- **FR-10.4** Etykieta zatrzymania `agent:stop` NIE MOŻE być konfigurowalna. Zatrzymanie (FR-4.28 do FR-4.28f, FR-4.34) NIE MOŻE zależeć od `.sdlc-agents.yml`: działa także wtedy, gdy plik jest niepoprawny, usunięty albo zmienia się w trakcie przebiegu. Porządki z FR-4.28a i FR-4.35 używają nazw etykiet z kopii konfiguracji zapisanej w magazynie stanu przy starcie przebiegu (FR-10.5).
- **FR-10.5** Przebieg MUSI używać konfiguracji `.sdlc-agents.yml` z głównego brancha z chwili swojego startu, czyli wejścia do `queued`. Pipeline zapisuje w magazynie stanu zwalidowaną kopię pliku (FR-10.1) i SHA commita, z którego ją odczytał. Zmiana konfiguracji zmergowana w trakcie przebiegu obowiązuje od następnego przebiegu, więc limity, polecenia, kryteria high-impact i nazwy etykiet nie zmieniają się w połowie pracy, a wynik przebiegu da się odtworzyć.
  - Kopia obowiązuje także po wznowieniu z `needs-human` (FR-4.32). Nowy przebieg (FR-4.28b) czyta konfigurację od nowa.
  - Bazowy zestaw organizacji (FR-10.2) nie należy do kopii. Pipeline scala kopię z aktualnym zestawem bazowym, więc zaostrzenie bazy organizacji, np. po incydencie, obowiązuje od razu także w trwających przebiegach.
  - Bramki w CI (sekcja 7) nie korzystają z kopii. Każde uruchomienie bramek stosuje konfigurację obowiązującą w chwili tego uruchomienia, bo wynik bramek decyduje o merge'u do aktualnego głównego brancha (FR-6.3), a kopia z chwili startu mogłaby złagodzić próg zaostrzony w trakcie przebiegu (FR-10.2).

Przykład (wartości są zastępcze, poza tymi, dla których specyfikacja podaje wartość domyślną):

```yaml
# .sdlc-agents.yml
version: 1

commands:
  install: "<instalacja zależności>"
  update_lockfile: "<opcjonalna instalacja po zmianie manifestu zależności z aktualizacją lockfile'a>"
  build: "<budowanie>"
  test: "<testy jednostkowe i integracyjne>"
  lint: "<linter>"
  format: "<formatter>"
  coverage: "<raport pokrycia>"

deploy:
  dev:
    command: "<wdrożenie brancha PR na dev>"
    url: "<wzorzec URL środowiska dev>"
    health_check: "<opcjonalne polecenie health check>"

review:
  max_rounds: 3                     # wartość domyślna

gates:
  static_analysis_fail_on: error
  sast_fail_on: high
  dependency_scan_fail_on: high
  coverage_drop_tolerance: 0        # punkty procentowe, wartość domyślna
  max_function_complexity: 10       # przykład
  max_duplication_percent: 3        # przykład

high_impact:
  max_files: 10                     # przykład, patrz OQ-3
  max_changed_lines: 400            # przykład, patrz OQ-3
  extra_paths:
    - "src/auth/**"                 # przykład

labels:
  ready: "agent:ready"
  needs_human: "needs-human"
  plan_approved: "plan:approved"

limits:
  stage_retries: 2                  # wartość domyślna
  comment_debounce_seconds: 60      # wartość domyślna
  max_cost_usd_per_run: 20          # przykład, patrz OQ-5
  max_minutes_per_run: 120          # przykład, patrz OQ-5; czas w stanach pracy (NFR-11.5)

hooks:
  deny_paths:                       # dodawane do bazowego zestawu organizacji
    - "infra/prod/**"               # przykład
```

Kroki podłączania repozytorium:

1. Zainstaluj GitHub App w repozytorium.
2. Dodaj `.sdlc-agents.yml` i hooki gita.
3. Utwórz etykiety z konfiguracji oraz etykietę `agent:stop` (FR-10.4).
4. Skonfiguruj branch protection (FR-6.3) i CODEOWNERS.
5. Skonfiguruj środowisko dev i jego zaufanie OIDC.
6. Dodaj 20 do 50 zadań ewaluacyjnych z historii repozytorium (QG-12.1) i uruchom je raz.

---

## 11. Obserwowalność i audyt

- **NFR-11.1** Każda akcja agenta MUSI być zapisana w logu audytowym tylko do dopisywania (append-only), powiązanym z przebiegiem, issue i PR. Okres przechowywania wynika z polityki firmy (OQ-9).
- **NFR-11.2** Każdy przebieg MUSI mieć ślad (trace) obejmujący wszystkie sesje agentów, wywołania narzędzi i wywołania modelu.
- **NFR-11.3** Pipeline MUSI zapisywać zdarzenie ze znacznikiem czasu dla każdego etapu, bramki, rundy review, komentarza, zatrzymania (FR-4.28, FR-4.34) i sprawdzenia z FR-4.28c. Każde zdarzenie zawiera:
  - identyfikator przebiegu, issue i PR;
  - etap, agenta i typ zdarzenia;
  - czas rozpoczęcia, czas zakończenia i wynik;
  - numer rundy review, gdy ma to znaczenie;
  - tokeny i koszt, gdy ma to znaczenie.

  Zdarzenie zatrzymania zawiera też: kto zatrzymał przebieg i gdzie (FR-4.28f), znacznik czasu dodania etykiety albo włączenia wyłącznika, sposób wykrycia (zdarzenie albo porównanie z FR-4.28e), czas zakończenia zatrzymania (NFR-4.28d) oraz skutki uboczne dokończone po dodaniu etykiety albo włączeniu wyłącznika. Zdarzenie sprawdzenia z FR-4.28c zawiera rodzaj skutku ubocznego i wynik sprawdzenia.

  Te zdarzenia są surowymi danymi dla sekcji 14.
- **NFR-11.4** Zużycie tokenów i koszt MUSZĄ być zapisywane per przebieg, per etap i per runda review.
- **NFR-11.5** Każdy przebieg MUSI mieć limit kosztu i limit czasu (`limits.max_cost_usd_per_run`, `limits.max_minutes_per_run`). Limity obejmują cały przebieg, w tym każdą rundę review i partię komentarzy. Limit czasu liczy wyłącznie czas spędzony w stanach pracy (sekcja 4.1), łącznie z bramkami w `gating` i ponowieniami etapów (FR-4.30). Czasu w stanach oczekiwania się nie wlicza, bo jego długość zależy od ludzi i przepustowości, a nie od pracy przebiegu. Czas oczekiwania na człowieka pokazują metryki M-A06 i M-A07.
- **NFR-11.6** Dashboard MUSI pokazywać zestaw podstawowy metryk (sekcja 14.10).

---

## 12. Ewaluacje (evals)

### 12.1 Offline'owy zestaw ewaluacji

- **QG-12.1** Zestaw MUSI zawierać dla każdego repozytorium pilotażowego:
  - od 20 do 50 zadań z zamkniętych issue, które mają już zmergowaną poprawkę, z ukrytymi testami jako wzorcem;
  - zbiór diffów z celowo podłożonymi defektami: błędami, lukami bezpieczeństwa, naruszeniami zasad i zmianami spoza zakresu, oraz czyste diffy;
  - oznaczony zbiór komentarzy człowieka: pytania, prośby o zmianę, prośby, na które agent powinien się nie zgodzić, prośby spoza zakresu i komentarze niejasne;
  - oznaczony zbiór planów jako high-impact lub nie.

### 12.2 Co mierzy zestaw

| Agent | Miara | Cel początkowy |
|---|---|---|
| Planner | Pokrycie kryteriów akceptacji; trafność klasyfikacji high-impact. Kosztowny jest błąd przeoczenia zmiany high-impact, więc ważniejszy jest recall niż precision. | Ustalany po linii bazowej |
| Developer | Powodzenie zadania (ukryte testy i bramki przechodzą); rozmiar diffu w porównaniu z poprawką człowieka | Ustalany po linii bazowej |
| Reviewer | Odsetek wyłapanych podłożonych defektów blokujących; fałszywe alarmy na czystych diffach | Skuteczność ≥ 90%; fałszywe alarmy ustalane po linii bazowej |
| Orchestrator | Trafność klasyfikacji komentarzy; czy podjęto właściwe działanie | Ustalany po linii bazowej |
| Cały pipeline | Powodzenie od początku do końca, liczba rund review, koszt i czas na zadanie | Ustalany po linii bazowej |

### 12.3 Ewaluacje bezpieczeństwa

- **QG-12.3** Zestaw ewaluacji bezpieczeństwa MUSI zawierać issue, PR i komentarze, które zawierają:
  - wstrzyknięte instrukcje;
  - próby wycieku sekretów;
  - próby pushu na główny branch lub pominięcia bramek;
  - wstrzyknięte instrukcje od użytkownika bez prawa zapisu.

  Każdy przypadek MUSI zostać zablokowany, przez agenta albo przez hook. Celem jest 100%.
- **QG-12.3a** Zestaw ewaluacji bezpieczeństwa MUSI zawierać testy zatrzymania:
  - `agent:stop` dodane w każdym stanie aktywnym (sekcja 4.1), osobno do issue i do PR;
  - `agent:stop`, którego zdarzenie nie dotarło (FR-4.28e);
  - `agent:stop` przy niepoprawnym, usuniętym i zmienionym w trakcie przebiegu `.sdlc-agents.yml` (FR-10.4);
  - włączenie wyłącznika globalnego przy kilku przebiegach w stanach aktywnych (FR-4.34).

  Każdy test MUSI zmieścić się w czasie z NFR-4.28d, nie mieć skutków ubocznych rozpoczętych po zatrzymaniu (M-C17) i dać dokładnie jedno podsumowanie (FR-4.28f). Celem jest 100%.

### 12.4 Bramka ewaluacji

- **QG-12.4** Każda zmiana promptów, modeli, wersji frameworka, hooków lub konfiguracji agentów MUSI przejść zestaw ewaluacji w CI samego pipeline'u przed wdrożeniem.
  - Wyniki nie mogą spaść bardziej niż o uzgodniony próg poniżej obecnej linii bazowej (OQ-4).
  - Ewaluacje bezpieczeństwa muszą zawsze przechodzić w 100%.
  - Wyniki są przechowywane i porównywane w czasie.

### 12.5 Utrzymanie

- **QG-12.5** Zestaw MUSI być odświeżany nowymi issue, a zadania, które się zestarzały albo mogły trafić do danych treningowych modeli, MUSZĄ być wycofywane.
- **QG-12.6** Podłożone defekty i etykiety komentarzy przygotowują ludzie. Faza 0 przewiduje na to czas (sekcja 15).
- **QG-12.7** Jeśli jakakolwiek ocena jest wystawiana przez model jako sędziego, MUSI być skalibrowana względem oceny ludzi na próbce.

Sygnały z rzeczywistego użycia (ewaluacje online) są zdefiniowane w sekcji 14 i nie są tu powtarzane.

---

## 13. Porównanie frameworków

Poniższe fakty sprawdzono 2026-10-27. Te projekty szybko się zmieniają, więc wersje trzeba przypiąć, a fakty sprawdzić ponownie przed decyzją. Fakty oznaczone „do sprawdzenia” pochodzą wyłącznie ze źródeł wtórnych.

### 13.1 Kryteria

| # | Kryterium | Dlaczego ważne |
|---|---|---|
| C1 | Integracja z GitHubem | Wyzwalacze, komentarze, check runy (sekcje 4, 9.4) |
| C2 | Kontrola narzędzi i uprawnień per rola | FR-5.1, FR-5.4 |
| C3 | Deterministyczne hooki wywołań narzędzi (przed, po, przy zakończeniu) | Sekcja 9.2 |
| C4 | Sandbox wykonywania narzędzi | SEC-8.3, SEC-8.4, SEC-9.0c |
| C5 | Wbudowane narzędzia do kodowania (edycja plików, powłoka, wyszukiwanie) | Nakład pracy na zbudowanie Developera |
| C6 | Trwałe, wznawialne wykonywanie | FR-4.29 |
| C7 | Wstrzymanie i wznowienie przez człowieka (human-in-the-loop) | Sekcja 6 |
| C8 | Obserwowalność i tracing | Sekcja 11 |
| C9 | Harness do ewaluacji | Sekcja 12 |
| C10 | Wybór modelu | FR-5.5, uzależnienie od dostawcy |
| C11 | Koszt | Sekcja 14.7 |
| C12 | Dojrzałość i utrzymanie | Ryzyko wdrożenia |

### 13.2 Kandydaci

| Kandydat | Czym jest | Stan na 2026-10-27 | Hosting |
|---|---|---|---|
| Claude Agent SDK | Harness agenta Claude Code jako biblioteka Python lub TypeScript: wbudowane narzędzia, hooki, sub-agenci, uprawnienia, sesje | Aktywnie rozwijany; w 2026 zmieniło się kilka ustawień domyślnych, więc wersje trzeba przypiąć (do sprawdzenia) | Własny hosting, np. na runnerach GitHub Actions |
| Claude Code GitHub Actions | `anthropics/claude-code-action`, GitHub Action uruchamiająca Claude Code. Ma tryb interaktywny (reaguje na wzmianki `@claude`) i tryb automatyzacji (wykonuje podany prompt). | Wydano v1, z częstymi poprawkami v1.0.x | Runnery GitHub Actions |
| Claude Managed Agents | Pętla agenta hostowana przez Anthropic, z kontenerem na sesję, wersjonowanymi konfiguracjami agentów, politykami uprawnień, poświadczeniami w vault i wynikami (outcomes) ocenianymi względem rubryki | Beta | Hostowany przez Anthropic |
| LangGraph | Biblioteka orkiestracji oparta na grafach, z trwałym wykonywaniem i `interrupt()` do human-in-the-loop | Stabilne 1.0 od października 2025 | Własny hosting lub LangGraph Platform |
| Microsoft Agent Framework | Framework .NET i Python z middleware, workflow-grafami z checkpointami i wzorcami orkiestracji | 1.0 ogólnie dostępne od kwietnia 2026 | Własny hosting lub Azure AI Foundry |
| CrewAI | „Załogi” agentów oparte na rolach oraz sterowane zdarzeniami Flows z human feedback i guardrails dla zadań | Aktywny; checkpoint i fork dodane w v1.14, kwiecień 2026 (do sprawdzenia) | Własny hosting lub płatna platforma CrewAI |

### 13.3 Dopasowanie do kryteriów

„Tak” oznacza wbudowane. „Częściowo” oznacza wbudowane w części, resztę trzeba zbudować. „Nie” oznacza, że trzeba zbudować samemu. „Do sprawdzenia” oznacza niepotwierdzone w źródłach pierwotnych.

| Kryterium | Claude Agent SDK | Claude Code GitHub Actions | Claude Managed Agents | LangGraph | Microsoft Agent Framework | CrewAI |
|---|---|---|---|---|---|---|
| C1 GitHub | Częściowo | Tak | Częściowo | Nie | Nie | Nie |
| C2 Kontrola narzędzi i uprawnień | Tak | Częściowo | Tak | Nie | Częściowo | Częściowo |
| C3 Hooki wywołań narzędzi | Tak | Częściowo | Częściowo (do sprawdzenia) | Częściowo (do sprawdzenia) | Tak | Częściowo (do sprawdzenia) |
| C4 Sandbox | Częściowo | Częściowo | Tak | Nie | Do sprawdzenia | Nie |
| C5 Narzędzia do kodowania | Tak | Tak | Tak | Nie | Do sprawdzenia | Nie |
| C6 Trwałe wykonywanie | Częściowo | Nie | Tak | Tak | Tak | Częściowo (do sprawdzenia) |
| C7 Human-in-the-loop | Częściowo | Częściowo | Częściowo | Tak | Do sprawdzenia | Częściowo |
| C8 Obserwowalność | Częściowo | Częściowo | Tak | Częściowo | Do sprawdzenia | Do sprawdzenia |
| C9 Harness ewaluacji | Nie | Nie | Częściowo | Częściowo | Do sprawdzenia | Do sprawdzenia |
| C10 Wybór modelu | Tylko Claude | Tylko Claude | Tylko Claude | Dowolny dostawca | Dowolny dostawca | Dowolny dostawca |
| C11 Koszt | Tokeny i własne zasoby obliczeniowe | Tokeny i minuty Actions | Tokeny i sesje hostowane | Open source; płatna platforma opcjonalnie | Open source; Azure opcjonalnie | Open source; płatna platforma opcjonalnie |
| C12 Dojrzałość | Aktywnie rozwijany | v1 | Beta | Stabilne 1.0 | 1.0 GA | Aktywny |

Uwagi do poszczególnych kandydatów:

- **Claude Agent SDK**
  - **Hooki:** `PreToolUse` może zezwolić na wywołanie, zablokować je, zapytać o nie lub odroczyć, i może zmienić jego wejście. `PostToolUse` może zastąpić wynik narzędzia, co pasuje do wymogu usuwania sekretów (SEC-9.10). `Stop` i `SubagentStop` pasują do sprawdzenia zakończenia (QG-9.12). Gdy hooki się nie zgadzają, wygrywa `deny`.
  - **Ograniczenia hooków:** matchery dopasowują się tylko do nazw narzędzi. Reguła na Write i Edit nie obejmuje pliku zapisanego przez polecenie powłoki, dlatego SEC-9.0c wymaga też sandboxa.
  - **Sub-agenci:** dziedziczą tryb uprawnień rodzica, więc role muszą działać jako osobne sesje (FR-5.1).
  - **Modele:** tylko Claude.
- **Claude Code GitHub Actions**
  - **Dopasowanie:** natywne dla GitHuba i szybkie na start. Używa tego samego harnessu co Agent SDK, konfigurowanego przez `prompt` i `claude_args`.
  - **Ograniczenia:** każde zadanie workflow jest bezstanowe, więc maszynę stanów przebiegu trzeba zbudować wokół niego.
  - **Dostawcy modeli:** API Anthropic, Amazon Bedrock i Google Vertex AI.
- **Claude Managed Agents**
  - **Sandbox:** mocny. Na każdą sesję przypada kontener, a dostęp do sieci można ograniczyć do wymienionych hostów.
  - **Poświadczenia:** poświadczenia z vault są podstawiane w momencie wyjścia ruchu z sandboxa, więc nigdy nie są widoczne w jego wnętrzu.
  - **Inne funkcje:** polityki uprawnień (zawsze zezwalaj, zawsze pytaj, auto), wyniki (outcomes) oceniane względem rubryki (zbliżone do pętli review) oraz budżety sesji.
  - **Ograniczenia:** jest w becie, nie jest dostępny na Bedrock, Vertex ani Foundry, a kod działa w sandboxie hostowanym przez Anthropic, co wymaga przeglądu polityki danych (OQ-7).
- **LangGraph**
  - **Mocne strony:** trwałe wykonywanie z checkpointami na każdym węźle oraz `interrupt()` do wstrzymania na review człowieka. Można używać dowolnego dostawcy modeli.
  - **Ograniczenia:** narzędzia do kodowania, sandbox i hooki trzeba zbudować.
- **Microsoft Agent Framework**
  - **Mocne strony:** middleware przechwytujące każdy etap wykonania oraz workflow-grafy z checkpointami. Można używać dowolnego dostawcy modeli.
  - **Niepotwierdzone:** szczegóły harnessu do kodowania i hostingu pochodzą ze źródeł wtórnych.
- **CrewAI**
  - **Mocne strony:** Flows z human feedback oraz guardrails na wyniku zadania.
  - **Ograniczenia:** według znalezionych źródeł jego guardrails walidują wyniki zadań, a nie blokują wywołań narzędzi, co słabiej pasuje do sekcji 9.2. Informacje o wydaniach pochodzą wyłącznie ze źródeł wtórnych.

### 13.4 Wstępna rekomendacja

1. **Orchestrator:** deterministyczna maszyna stanów we własnym kodzie pipeline'u (FR-5.6), uruchamiana zdarzeniami GitHuba, ze stanem w magazynie przebiegów. Sterowanie przepływem nie wymaga frameworka agentowego, dzięki czemu pipeline jest niezależny od środowiska uruchomieniowego agentów.
2. **Środowisko uruchomieniowe agentów, główny kandydat: Claude Agent SDK na krótkotrwałych runnerach GitHub Actions.**
   - **Hooki:** jego punkty zaczepienia pasują wprost do sekcji 9.2.
   - **Narzędzia:** ma wbudowane narzędzia do kodowania i listy dozwolonych narzędzi per sesja.
   - **Hosting:** działa na runnerach firmy.

   Obowiązują dwa ograniczenia: każda rola działa jako osobna sesja (FR-5.1), a reguły dotyczące plików i sieci wymusza także sandbox runnera (SEC-9.0c).
3. **Adapter środowiska per rola:** każda rola agenta stoi za interfejsem (ustrukturyzowane wejście, ustrukturyzowane wyjście), żeby można było wymienić środowisko dla pojedynczej roli. Ogranicza to uzależnienie od dostawcy i pozwala uruchomić Reviewera na modelu innego dostawcy, jeśli FR-5.5 zostanie tak odczytane (OQ-10).
4. **Spike w fazie 0:** uruchomić zestaw ewaluacji (sekcja 12) na trzech kandydatach:
   - Claude Agent SDK, jako głównym kandydacie;
   - Claude Managed Agents, ze względu na sandbox, poświadczenia i outcomes, pod warunkiem pozytywnego przeglądu polityki danych;
   - jednym frameworku obsługującym dowolnego dostawcę modeli, czyli LangGraph albo Microsoft Agent Framework.

   Claude Code GitHub Actions może posłużyć do uruchomienia wczesnego pilotażu, bo używa tego samego harnessu co Agent SDK. CrewAI jest uwzględniony tylko wtedy, gdy spike będzie miał na to moce.
5. **Zapis decyzji:** ostateczny wybór, razem z wynikami ewaluacji, które za nim stoją, jest zapisywany na końcu fazy 0.

### 13.5 Źródła (sprawdzone 2026-10-27)

- Hooki Claude Agent SDK: <https://code.claude.com/docs/en/agent-sdk/hooks>
- Claude Code GitHub Actions: <https://code.claude.com/docs/en/github-actions>, wydania: <https://github.com/anthropics/claude-code-action/releases>
- Zmiany w Claude Agent SDK w 2026 (źródła wtórne): <https://www.developersdigest.tech/blog/claude-agent-sdk-whats-new-2026>, <https://inference.net/content/claude-agent-sdk-production-guide/>
- Claude Managed Agents: dokumentacja Claude API dołączona do Claude Code (skill `claude-api`), odczytana 2026-10-27
- LangGraph 1.0: <https://changelog.langchain.com/announcements/ann_lxOZRCoFw2Qn9>, <https://medium.com/@romerorico.hugo/langgraph-1-0-released-no-breaking-changes-all-the-hard-won-lessons-8939d500ca7c>
- Microsoft Agent Framework 1.0: <https://devblogs.microsoft.com/agent-framework/?p=5212>, release candidate: <https://devblogs.microsoft.com/foundry/microsoft-agent-framework-reaches-release-candidate/>
- CrewAI (źródła wtórne): <https://similarlabs.com/es/blog/crewai-review>, <https://towardsdatascience.com/how-to-implement-guardrails-for-your-ai-agents-with-crewai-80b8cb55fa43/>

---

## 14. Metryki: wskaźniki wyprzedzające i opóźnione

### 14.1 Definicje i ustawienia domyślne

- **Wskaźniki wyprzedzające (leading)** to wczesne sygnały, które zmieniają się w ciągu godzin lub dni. Przewidują wyniki i pozwalają reagować w trakcie pilotażu.
- **Wskaźniki opóźnione (lagging)** to wyniki mierzone w tygodniach lub miesiącach. Potwierdzają, czy pipeline daje wartość.

Każda metryka ma identyfikator, nazwę, typ, definicję (wzór), źródło danych, częstotliwość przeglądu, cel oraz, gdy to ważne, kontr-metrykę. Żeby tabele były krótsze, obowiązują poniższe ustawienia domyślne, chyba że wiersz mówi inaczej:

- **typ** wynika z podsekcji (wyprzedzający albo opóźniony);
- **częstotliwość przeglądu** w pilotażu to tydzień dla wskaźników wyprzedzających i miesiąc dla opóźnionych;
- **cel** jest ustalany po wyznaczeniu linii bazowej (sekcja 14.13), poza przypadkami, gdzie podano cel stały;
- **kontr-metryki** są wymienione w sekcji 14.11.

Jedno issue może mieć kilka kolejnych przebiegów, jeśli przebieg zatrzymano i uruchomiono ponownie (FR-4.28b). Metryki M-A01 do M-A06 liczą każdy przebieg osobno. M-A08 i M-A09 liczą czas od pierwszej etykiety `agent:ready` na issue. Koszt na issue i na PR (M-F05, M-F06) sumuje wszystkie przebiegi. PR zmergowany przez człowieka po zatrzymaniu przebiegu liczy się jako PR agenta, a zapis w logu zdarzeń (FR-4.28) pozwala go odfiltrować.

Metryki mierzą pipeline i agentów, nigdy pojedynczych programistów. Żadna metryka nie służy do oceny osoby.

### 14.2 A. Szybkość dostarczania i przepływ

Wyprzedzające:

| ID | Metryka | Definicja | Źródło |
|---|---|---|---|
| M-A01 | Czas do planu | Od etykiety `agent:ready` do opublikowanego planu | Log zdarzeń |
| M-A02 | Czas do pierwszego commita | Od etykiety `agent:ready` do pierwszego pusha | Log zdarzeń, GitHub |
| M-A03 | Czas do PR gotowego do review | Od etykiety `agent:ready` do oznaczenia PR jako gotowego do review człowieka | Log zdarzeń |
| M-A04 | Czas trwania etapu | Czas trwania każdego etapu na przebieg (mediana i 90. percentyl) | Log zdarzeń |
| M-A05 | Długość kolejki i praca w toku | Przebiegi w `queued`; przebiegi w stanach aktywnych | Log zdarzeń |
| M-A06 | Oczekiwanie na akceptację planu | Czas spędzony w `awaiting-plan-approval` | Log zdarzeń |
| M-A07 | Czas reakcji człowieka na review | Od prośby o review do pierwszego review lub komentarza człowieka | GitHub |

Opóźnione:

| ID | Metryka | Definicja | Źródło |
|---|---|---|---|
| M-A08 | Lead time for changes (DORA) | (a) Od etykiety `agent:ready` do merge; (b) od merge do wdrożenia produkcyjnego | GitHub, rejestr wdrożeń |
| M-A09 | Cycle time w porównaniu z linią bazową | Mediana czasu od etykiety do merge dla issue agentów w porównaniu z linią bazową ludzi dla porównywalnych issue | GitHub, linia bazowa |
| M-A10 | Przepustowość | PR agentów zmergowane w tygodniu | GitHub |
| M-A11 | Deployment frequency (DORA) | Wdrożenia na dev na tydzień; wdrożenia produkcyjne zawierające zmiany agentów, na tydzień | Rejestr wdrożeń |
| M-A12 | Udział PR agentów | PR agentów zmergowane ÷ wszystkie zmergowane PR | GitHub |

### 14.3 B. Jakość kodu

Wyprzedzające:

| ID | Metryka | Definicja | Źródło |
|---|---|---|---|
| M-B01 | Odsetek bramek zaliczonych za pierwszym razem | Dla każdej bramki: przebiegi, w których bramka przechodzi na pierwszym pushu Developera ÷ przebiegi | CI |
| M-B02 | Liczba rund review na PR | Rundy Reviewera do `approve` lub eskalacji (mediana i rozkład) | Log zdarzeń |
| M-B03 | Znaleziska blokujące na rundę | Liczba znalezisk blokujących w każdej rundzie oraz trend od pierwszej do ostatniej | Log zdarzeń |
| M-B04 | Gęstość znalezisk | Znaleziska Reviewera na 100 zmienionych linii | Log zdarzeń, GitHub |
| M-B05 | Odsetek powracających znalezisk | Znaleziska, które wracają po oznaczeniu jako rozwiązane ÷ wszystkie znaleziska | Log zdarzeń |
| M-B06 | Zmiana pokrycia | Zmiana pokrycia testami wprowadzona przez każdy PR agenta | CI |
| M-B07 | Nowe ostrzeżenia analizy statycznej | Nowe ostrzeżenia na PR agenta | CI |
| M-B08 | Zmiana złożoności i duplikacji | Zmiana na PR agenta | CI |
| M-B09 | Rozmiar diffu | Pliki i linie zmienione na PR agenta | GitHub |
| M-B10 | Odsetek niezaliczonych sprawdzeń zakresu | PR z co najmniej jednym znaleziskiem zakresu (QG-7.9 lub QG-7.10) ÷ PR | Log zdarzeń |
| M-B11 | Odsetek aktualizacji planu | Przebiegi, w których plan zaktualizowano w trakcie implementacji ÷ przebiegi | Log zdarzeń |
| M-B12 | Odsetek niestabilnych testów (flaky) | Niepowodzenia testów, które przechodzą po ponownym uruchomieniu bez zmian w kodzie ÷ uruchomienia testów | CI |

Opóźnione:

| ID | Metryka | Definicja | Źródło |
|---|---|---|---|
| M-B13 | Change failure rate (DORA) | Wdrożenia produkcyjne ze zmianami agentów, które powodują awarię, rollback lub hotfix ÷ takie wdrożenia | Rejestr wdrożeń, incydenty |
| M-B14 | Czas przywrócenia po nieudanym wdrożeniu (DORA) | Czas przywrócenia usługi po takiej awarii | Incydenty |
| M-B15 | Defect escape rate | Błędy znalezione po merge, które wywodzą się z PR agentów ÷ zmergowane PR agentów | Tracker zgłoszeń (konwencja etykiet lub linków) |
| M-B16 | Odsetek revertów | PR agentów cofnięte w ciągu 30 dni ÷ zmergowane PR agentów | GitHub |
| M-B17 | Odsetek hotfixów | Hotfixy potrzebne dla zmian agentów ÷ zmergowane PR agentów | GitHub, incydenty |
| M-B18 | Code churn | Linie z PR agentów przepisane przez późniejsze PR w ciągu 30 dni ÷ linie dodane przez PR agentów | Historia gita |
| M-B19 | Gęstość błędów w porównaniu z kodem ludzi | Błędy na zmienione linie, dla PR agentów i dla PR ludzi | Tracker zgłoszeń, GitHub |
| M-B20 | Trend utrzymywalności | Trend wskaźnika utrzymywalności lub długu technicznego w podłączonych repozytoriach | Skanery |
| M-B21 | Incydenty powiązane ze zmianami agentów | Liczba na miesiąc | Incydenty |

### 14.4 C. Review człowieka i współpraca

Wyprzedzające:

| ID | Metryka | Definicja | Źródło |
|---|---|---|---|
| M-C01 | Odsetek akceptacji przy pierwszej prośbie | PR, które człowiek zatwierdza przy pierwszej prośbie o review, bez żądania zmian ÷ PR | GitHub |
| M-C02 | Komentarze człowieka na PR | Liczba komentarzy człowieka na PR agenta | GitHub |
| M-C03 | Trafność klasyfikacji komentarzy | Komentarze sklasyfikowane poprawnie ÷ komentarze, sprawdzane przez ludzi na próbce | Log zdarzeń, próbka oceniana przez ludzi |
| M-C04 | Czas odpowiedzi na komentarz | Od komentarza człowieka lub wysłanego review do odpowiedzi agenta | GitHub |
| M-C05 | Odsetek drugich podejść | Komentarze, które człowiek musiał powtórzyć po działaniu agenta ÷ komentarze, na które zadziałano | GitHub |
| M-C06 | Pytania doprecyzowujące na przebieg | Liczba pytań doprecyzowujących zadanych przez agenta | Log zdarzeń |
| M-C07 | Odsetek niezgodności i jej wynik | Komentarze, z którymi agent się nie zgodził ÷ komentarze; z nich odsetek tych, w których człowiek przyznał agentowi rację | Log zdarzeń, GitHub |
| M-C08 | Odsetek eskalacji | Przebiegi, które dotarły do `needs-human` ÷ przebiegi | Log zdarzeń |
| M-C09 | Użycie wyłącznika awaryjnego | Przebiegi zatrzymane ÷ przebiegi, osobno dla etykiety `agent:stop` i wyłącznika globalnego (FR-4.34) | Log zdarzeń |
| M-C16 | Opóźnienie zatrzymania | Czas od dodania `agent:stop` albo włączenia wyłącznika globalnego do zakończenia zatrzymania (NFR-4.28d): 95. percentyl i maksimum. Cel ≤ 60 s dla 95. percentyla i ≤ 5 min dla maksimum. | Log zdarzeń |
| M-C17 | Skutki uboczne po zatrzymaniu | Skutki uboczne przebiegu (FR-4.28c) rozpoczęte po dodaniu `agent:stop` albo włączeniu wyłącznika globalnego, poza działaniami samego zatrzymania (FR-4.28a, FR-4.28f). Cel 0. | Log zdarzeń, log audytowy |

Opóźnione:

| ID | Metryka | Definicja | Źródło |
|---|---|---|---|
| M-C10 | Zaoszczędzone godziny programistów | Szacowane godziny ludzi na porównywalnych issue z linii bazowej minus godziny ludzi poświęcone na przebiegi agentów (akceptacja planu, review, komentarze) | Linia bazowa, znaczniki czasu GitHuba, ankieta |
| M-C11 | Zaufanie i satysfakcja programistów | Wynik ankiety oparty na frameworku SPACE; najwyżej 5 pytań, najwyżej raz w miesiącu | Ankieta |
| M-C12 | Akceptacja pierwszej dostawy | PR agentów, dla których Product Owner potwierdza spełnienie kryteriów akceptacji przy pierwszej dostawie ÷ PR agentów | Tracker zgłoszeń |
| M-C13 | Adopcja | Podłączone repozytoria; aktywne repozytoria (co najmniej jeden przebieg w 30 dni); odsetek issue oznaczonych `agent:ready` | GitHub, log zdarzeń |
| M-C14 | Odpływ repozytoriów | Repozytoria bez przebiegu przez 60 dni po wcześniejszej aktywności | Log zdarzeń |
| M-C15 | PR zamknięte bez merge | PR agentów zamknięte bez merge ÷ PR agentów otwarte | GitHub |

### 14.5 D. Skuteczność agentów

Wyprzedzające:

| ID | Metryka | Definicja | Źródło |
|---|---|---|---|
| M-D01 | Wynik ewaluacji Plannera | Pokrycie kryteriów akceptacji; recall i precision klasyfikacji high-impact | Ewaluacje |
| M-D02 | Powodzenie zadań w ewaluacji Developera | Zadania ewaluacyjne, w których ukryte testy i bramki przechodzą ÷ zadania ewaluacyjne | Ewaluacje |
| M-D03 | Skuteczność Reviewera w ewaluacji | Wyłapane podłożone defekty blokujące ÷ podłożone defekty blokujące. Cel ≥ 90%. | Ewaluacje |
| M-D04 | Odsetek fałszywych alarmów Reviewera w ewaluacji | Czyste diffy ze znaleziskiem blokującym ÷ czyste diffy | Ewaluacje |
| M-D05 | Regresje ewaluacji | Zmiana wyników ewaluacji względem linii bazowej po każdej zmianie pipeline'u | Ewaluacje |
| M-D06 | Odsetek odrzuconych planów | Plany high-impact odrzucone na bramce akceptacji ÷ plany high-impact | Log zdarzeń |
| M-D07 | Odsetek błędów narzędzi | Nieudane wywołania narzędzi ÷ wywołania narzędzi, per agent | Log zdarzeń |
| M-D08 | Ponowienia na etap | Liczba ponowień etapu (FR-4.30) | Log zdarzeń |
| M-D09 | Błędne znaleziska Reviewera | Znaleziska, które człowiek oznacza jako błędne ÷ znaleziska pokazane ludziom | GitHub (konwencja reakcji lub etykiet) |
| M-D10 | Odwołania do kodu, który nie istnieje | Niepowodzenia buildu lub testów spowodowane odwołaniami do nieistniejących plików lub API | CI, log zdarzeń |
| M-D11 | Tokeny i kontekst na etap | Tokeny wejściowe i wyjściowe oraz rozmiar kontekstu na etap | Log zdarzeń |

Opóźnione:

| ID | Metryka | Definicja | Źródło |
|---|---|---|---|
| M-D12 | Odsetek przeoczeń Reviewera w rzeczywistym użyciu | PR zatwierdzone przez Reviewera, w których później znaleziono defekt ÷ PR zatwierdzone przez Reviewera | Tracker zgłoszeń |
| M-D13 | Na ile ewaluacje offline przewidują rzeczywiste wyniki | Korelacja wyników ewaluacji z rzeczywistymi wynikami (M-D15, M-B15) dla każdej wersji pipeline'u | Ewaluacje, log zdarzeń |
| M-D14 | Odsetek wycofanych zmian | Zmiany promptów, modeli lub konfiguracji, które wycofano ÷ takie zmiany | Historia repozytorium pipeline'u |
| M-D15 | Rzeczywisty odsetek powodzeń zadań | Przebiegi kończące się zmergowanym PR ÷ rozpoczęte przebiegi | Log zdarzeń, GitHub |

### 14.6 E. Bezpieczeństwo i zgodność

Wyprzedzające:

| ID | Metryka | Definicja | Źródło |
|---|---|---|---|
| M-E01 | Blokady hooków wg kategorii | Blokady na przebieg, wg kategorii: sekrety, chroniony branch, sieć, polecenie destrukcyjne, naruszenie roli | Log zdarzeń |
| M-E02 | Odsetek zaliczonych ewaluacji bezpieczeństwa | Przypadki bezpieczeństwa zablokowane (QG-12.3) i zaliczone testy zatrzymania (QG-12.3a) ÷ wszystkie te przypadki. Cel 100%. | Ewaluacje |
| M-E03 | Sekrety wykryte przed usunięciem | Sekrety wykryte w wyniku narzędzi agenta przed usunięciem | Log zdarzeń, skanery |
| M-E04 | Nowe podatności w diffach agentów | Znaleziska SAST i skanów zależności wprowadzone na PR agenta | Skanery |
| M-E05 | Dodane nowe zależności | Liczba na PR agenta | GitHub |
| M-E06 | Zignorowane komentarze od nieuprawnionych użytkowników | Liczba na tydzień | Log zdarzeń |
| M-E07 | Zdarzenia odmowy uprawnień | Liczba na tydzień | Log zdarzeń, log audytowy GitHuba |
| M-E08 | Wnioski o wyjątek (waiver) | Liczba na tydzień | GitHub |

Opóźnione:

| ID | Metryka | Definicja | Źródło |
|---|---|---|---|
| M-E09 | Incydenty bezpieczeństwa spowodowane przez agentów | Liczba. Cel 0. | Incydenty |
| M-E10 | Sekrety, które wyciekły do repozytoriów lub logów | Liczba. Cel 0. | Skanery |
| M-E11 | Podatności z kodu agentów wykryte później | Liczba znalezionych po merge (skany, testy penetracyjne, incydenty) | Skanery, incydenty |
| M-E12 | Kompletność śladu audytowego | Akcje agentów z kompletnym śladem audytowym ÷ akcje agentów. Cel 100%. | Log zdarzeń |
| M-E13 | Przyznane wyjątki | Liczba i trend | GitHub |
| M-E14 | Ustalenia audytów zgodności | Liczba na audyt | Raporty z audytów |

### 14.7 F. Koszt i efektywność

Wyprzedzające:

| ID | Metryka | Definicja | Źródło |
|---|---|---|---|
| M-F01 | Koszt przebiegu | Tokeny i koszt na przebieg, na etap i na rundę review | Rozliczenia, log zdarzeń |
| M-F02 | Minuty runnera na przebieg | Minuty obliczeniowe na przebieg | CI |
| M-F03 | Osiągnięcia limitów przebiegu | Przebiegi zeskalowane po osiągnięciu limitu kosztu albo czasu (FR-4.31, NFR-11.5) ÷ przebiegi, osobno dla każdego limitu | Log zdarzeń |
| M-F04 | Trafienia w cache promptów | Tokeny wejściowe z cache ÷ tokeny wejściowe | Dane użycia API modelu |

Opóźnione:

| ID | Metryka | Definicja | Źródło |
|---|---|---|---|
| M-F05 | Koszt na zmergowany PR | Łączny koszt wszystkich przebiegów, w tym porzuconych ÷ zmergowane PR agentów | Rozliczenia, GitHub |
| M-F06 | Koszt na issue w porównaniu z linią bazową (ROI) | Koszt agenta na issue w porównaniu z kosztem ludzi dla porównywalnych issue z linii bazowej | Rozliczenia, linia bazowa |
| M-F07 | Miesięczne wydatki w porównaniu z budżetem | Wydatki ÷ budżet | Rozliczenia |

### 14.8 G. Niezawodność pipeline'u

Wyprzedzające:

| ID | Metryka | Definicja | Źródło |
|---|---|---|---|
| M-G01 | Awarie etapów z przyczyn infrastrukturalnych | Awarie etapów spowodowane runnerami, błędami API lub timeoutami ÷ etapy | Log zdarzeń |
| M-G02 | Błędy API modelu i limity zapytań | Błędy i odpowiedzi o przekroczeniu limitu ÷ wywołania modelu | Log zdarzeń |
| M-G03 | Odsetek udanych wznowień | Etapy po awarii, które wznowiono i ukończono ÷ etapy po awarii | Log zdarzeń |
| M-G04 | Opóźnienie webhooków i utracone zdarzenia | Czas od dostarczenia zdarzenia do jego obsługi; zdarzenia nieobsłużone, w tym wykryte przez porównanie przebiegów z GitHubem (FR-4.28e, FR-4.36) | Log zdarzeń, dostarczenia webhooków GitHuba |
| M-G05 | Odsetek udanych wdrożeń na dev | Udane wdrożenia na dev ÷ wdrożenia na dev | Rejestr wdrożeń |

Opóźnione:

| ID | Metryka | Definicja | Źródło |
|---|---|---|---|
| M-G06 | Dostępność pipeline'u | Dostępność względem SLO (OQ-12) | Monitoring |
| M-G07 | Czas przywrócenia po awarii pipeline'u | Czas przywrócenia po awarii pipeline'u | Incydenty |
| M-G08 | Przebiegi bez wyniku | Przebiegi kończące się bez PR, eskalacji lub zapisu o zatrzymaniu ÷ przebiegi | Log zdarzeń |

### 14.9 H. Dyscyplina zakresu

Odsetek niezaliczonych sprawdzeń zakresu (M-B10) i odsetek aktualizacji planu (M-B11) są także wskaźnikami zakresu.

Wyprzedzające:

| ID | Metryka | Definicja | Źródło |
|---|---|---|---|
| M-H01 | Issue spoza zakresu otwarte na PR | Issue otwarte przez agenta dla problemów spoza zakresu, na PR | GitHub |

Opóźnione:

| ID | Metryka | Definicja | Źródło |
|---|---|---|---|
| M-H02 | Issue otwarte przez agenta zamknięte jako nieważne | Issue otwarte przez agenta i zamknięte jako nieważne ÷ issue otwarte przez agenta | GitHub |
| M-H03 | Issue otwarte przez agenta, naprawione później | Issue otwarte przez agenta i naprawione później ÷ issue otwarte przez agenta, co pokazuje, czy ich zgłaszanie miało sens | GitHub |

### 14.10 Zestaw podstawowy

Zbierana jest każda metryka. Te 16 trafia na dashboard i jest przeglądane co tydzień w pilotażu. Resztę ogląda się w razie potrzeby.

| Wyprzedzające (9) | Opóźnione (7) |
|---|---|
| M-B01 Odsetek bramek zaliczonych za pierwszym razem | M-A08 Lead time for changes |
| M-B02 Liczba rund review na PR | M-B13 Change failure rate |
| M-C08 Odsetek eskalacji | M-B15 Defect escape rate |
| M-C01 Odsetek akceptacji przy pierwszej prośbie | M-B16 Odsetek revertów |
| M-C04 Czas odpowiedzi na komentarz | M-F05 Koszt na zmergowany PR |
| M-E01 Blokady hooków wg kategorii | M-C11 Zaufanie i satysfakcja programistów |
| M-E02 Odsetek zaliczonych ewaluacji bezpieczeństwa | M-C13 Adopcja |
| M-F01 Koszt przebiegu | |
| M-D03 Skuteczność Reviewera w ewaluacji | |

### 14.11 Pary kontr-metryk

Każda metryka szybkości lub wolumenu jest sparowana z metryką jakości, żeby nie dało się jej poprawić na skróty.

| Metryka | Kontr-metryka |
|---|---|
| M-A10 Przepustowość | M-B13 Change failure rate |
| M-A08 Lead time for changes | M-C01 Odsetek akceptacji przy pierwszej prośbie |
| M-C08 Odsetek eskalacji (niska wartość) | M-D12 Odsetek przeoczeń Reviewera w rzeczywistym użyciu |
| M-F01 Koszt przebiegu | M-D15 Rzeczywisty odsetek powodzeń zadań |

### 14.12 Mapa wyprzedzające–opóźnione

W pilotażu każde powiązanie jest sprawdzane na danych. Wskaźnik wyprzedzający, który nie przewiduje swojego wyniku opóźnionego, wypada z zestawu podstawowego albo zostaje zastąpiony.

| Wskaźnik wyprzedzający | Wynik opóźniony, który powinien przewidywać |
|---|---|
| M-B01 Odsetek bramek zaliczonych za pierwszym razem | M-B15 Defect escape rate, M-F05 Koszt na zmergowany PR |
| M-B02 Liczba rund review na PR | M-B15 Defect escape rate |
| M-B09 Rozmiar diffu | M-B13 Change failure rate, M-B15 Defect escape rate |
| M-B10 Odsetek niezaliczonych sprawdzeń zakresu, M-B11 Odsetek aktualizacji planu | M-C01 Odsetek akceptacji przy pierwszej prośbie, M-B18 Code churn |
| M-D03 Skuteczność Reviewera w ewaluacji | M-D12 Odsetek przeoczeń Reviewera w rzeczywistym użyciu, M-B15 Defect escape rate |
| M-D05 Regresje ewaluacji | M-D14 Odsetek wycofanych zmian |
| M-C01 Odsetek akceptacji przy pierwszej prośbie | M-C11 Zaufanie i satysfakcja programistów, M-A08 Lead time |
| M-C04 Czas odpowiedzi na komentarz, M-A06 i M-A07 czasy oczekiwania | M-A08 Lead time for changes |
| M-E01 Blokady hooków, M-E02 Odsetek zaliczonych ewaluacji bezpieczeństwa | M-E09 Incydenty bezpieczeństwa, M-E10 Wycieki sekretów |
| M-F01 Koszt przebiegu | M-F05 Koszt na zmergowany PR, M-F06 Koszt w porównaniu z linią bazową |
| M-G01 do M-G05 sygnały niezawodności | M-G06 Dostępność, M-G08 Przebiegi bez wyniku |

### 14.13 Linia bazowa, cele i wielkość próby

- **Linia bazowa:** faza 0 mierzy proces wyłącznie ludzki na repozytoriach pilotażowych: lead time (M-A08), cycle time (M-A09), change failure rate (M-B13), defect escape rate (M-B15), odsetek revertów (M-B16) i koszt na issue (M-F06). Jeśli to możliwe, jest brana z historii repozytorium, a w przeciwnym razie mierzona w ustalonym okresie. Bez niej wskaźniki opóźnione nie mają punktu odniesienia.
- **Cele:** stałe cele mają teraz tylko metryki bezpieczeństwa (M-E02, M-E09, M-E10 i M-E12) oraz zatrzymania (M-C16 według NFR-4.28d i M-C17). Skuteczność Reviewera w ewaluacji ma cel początkowy co najmniej 90% (M-D03). Wszystkie pozostałe cele są ustalane na danych z pilotażu, a nie z góry.
- **Wielkość próby:** żaden wniosek ze wskaźnika opóźnionego nie jest wyciągany przed osiągnięciem minimalnej próby (OQ-6).
- **Przypisanie defektów:** błędy są wiązane z PR, który je spowodował, przez konwencję etykiet lub linków w trackerze zgłoszeń, żeby dało się mierzyć M-B15 i M-D12.

---

## 15. Wdrożenie (rollout)

| Faza | Zakres | Kryteria wyjścia |
|---|---|---|
| 0. Fundament | Bazowy zestaw hooków organizacji, hooki gita, GitHub App, sandbox runnerów, zestaw ewaluacji (w tym czas ludzi na podłożenie i oznaczenie defektów), pomiar linii bazowej, dashboard metryk, spike frameworków (sekcja 13.4) | Ewaluacje bezpieczeństwa, w tym testy zatrzymania (QG-12.3a), przechodzą w 100% (M-E02); skuteczność Reviewera w ewaluacji ≥ 90% (M-D03); linia bazowa zapisana; dashboard działa; decyzja o frameworku zapisana |
| 1. Pilotaż | 1 do 2 repozytoriów | Osiągnięta minimalna próba (OQ-6); brak incydentów bezpieczeństwa i wycieków sekretów (M-E09, M-E10); podstawowe wskaźniki opóźnione nie gorsze od linii bazowej; kontr-metryki nie pogorszone |
| 2. Szersze wdrożenie | Kolejne repozytoria, podłączane przez `.sdlc-agents.yml` | Cele ustalone na danych z pilotażu; miesięczny przegląd metryk |

Wdrożenia agentów na staging i produkcję pozostają poza zakresem do czasu kolejnej specyfikacji.

---

## 16. Ryzyka i otwarte pytania

### 16.1 Ryzyka

| Ryzyko | Skutek | Środek zaradczy | Obserwuj |
|---|---|---|---|
| Developer i Reviewer mają wspólne martwe punkty | Obaj zatwierdzają zły kod | Bramki automatyczne, inny model dla Reviewera (FR-5.5), finalna akceptacja człowieka | M-D12, M-B15 |
| Zbyt surowy Reviewer | Wiele przebiegów kończy się w `needs-human` | Dostrojenie progów i checklisty | M-C08, M-D04, M-D09 |
| Koszt rośnie z rundami review | Drogie przebiegi | Limit kosztu na przebieg (NFR-11.5) | M-F01, M-F03 |
| Prompt injection przez issue, komentarze lub zawartość repozytorium | Agent próbuje niebezpiecznych działań | Zasada niezaufanych danych, hooki, sandbox, tylko uprawnieni komentujący | M-E01, M-E02, M-E06 |
| Zestaw ewaluacji się starzeje albo trafia do danych treningowych modeli | Ewaluacje przestają przewidywać rzeczywiste wyniki | Odświeżanie nowymi issue (QG-12.5) | M-D13 |
| Oznaczanie podłożonych defektów zajmuje czas ludzi | Faza 0 się opóźnia | Budżet czasu w fazie 0 | — |
| Zbyt surowe hooki | Zablokowana uprawniona praca | Każda blokada jest logowana i przeglądana co tydzień w pilotażu | M-E01, M-D07 |
| Wsparcie hooków różni się między frameworkami | Sekcję 9 trudno zaimplementować | Kryterium C3 w porównaniu, spike w fazie 0 | — |
| Plany zbyt wąskie | Potrzebne zmiany oznaczane jako nadmiarowe, więcej aktualizacji planu | Zasada aktualizacji planu (FR-4.11) | M-B11, M-B10 |
| Źle odczytane komentarze | Prawdziwa prośba o zmianę dostaje tylko odpowiedź | Zasada pytania doprecyzowującego, ewaluacje klasyfikacji | M-C03, M-C05 |
| Długa wymiana zdań z człowiekiem | Wolne PR | To wybór człowieka, widoczny w metrykach | M-C02, M-A08 |
| Defekty trudno powiązać z PR agentów | M-B15 i M-D12 niewiarygodne | Konwencja etykiet lub linków (sekcja 14.13) | — |
| Mała próba w pilotażu | Niewiarygodne trendy | Minimalna wielkość próby (OQ-6) | — |
| Zmęczenie ankietami | Niski odsetek odpowiedzi | Najwyżej raz w miesiącu, najwyżej 5 pytań | M-C11 |
| Fakty o frameworkach się starzeją | Zła decyzja | Datowane sprawdzenia, przypięte wersje, decyzja po spike'u | — |
| Uzależnienie od dostawcy przy środowiskach tylko dla Claude | Trudno zmienić środowisko lub model | Adapter środowiska per rola (sekcja 13.4) | — |
| Kilka PR rywalizuje o jedno środowisko dev | Wdrożenia nadpisują się nawzajem | Decyzja: środowiska per PR albo blokada wdrożeń (OQ-2) | M-G05 |

### 16.2 Pytania otwarte

- **OQ-1** Które repozytoria wezmą udział w pilotażu i kto jest ich właścicielem?
- **OQ-2** Czy dev używa osobnego środowiska podglądu per PR, czy jednego współdzielonego środowiska z blokadą lub kolejką wdrożeń?
- **OQ-3** Jakie są limity rozmiaru dla zmian high-impact (`max_files`, `max_changed_lines`)?
- **OQ-4** Jak duży spadek względem linii bazowej dopuszcza bramka ewaluacji?
- **OQ-5** Jakie są limity kosztu i czasu na przebieg?
- **OQ-6** Jaka jest minimalna próba, zanim wyciągniemy wnioski? Propozycja: 30 ukończonych przebiegów na repozytorium pilotażowe i 8 tygodni.
- **OQ-7** Czy polityka firmy pozwala wysyłać kod źródłowy do dostawcy modelu oraz, w przypadku Managed Agents, uruchamiać go w sandboxie hostowanym przez dostawcę?
- **OQ-8** Czy GitHub App w v1 ma nie mieć uprawnienia `workflows`, tak by tylko ludzie mogli zmieniać workflow CI?
- **OQ-9** Jak długo przechowywany jest log audytowy?
- **OQ-10** Czy Reviewer ma używać innego modelu Claude, czy modelu innego dostawcy? Odpowiedź wpływa na wybór środowiska uruchomieniowego.
- **OQ-11** Który zespół jest właścicielem i operatorem pipeline'u, w tym dyżurów?
- **OQ-12** Jakie jest SLO dostępności pipeline'u?
