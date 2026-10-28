# Wieloagentowy pipeline SDLC

Specyfikacja pipeline'u, w którym wyspecjalizowani agenci AI przejmują GitHub Issue oznaczone przez człowieka, implementują zmianę, recenzują ją w pętli i wdrażają na środowisko dev. Finalna akceptacja i merge zostają w rękach człowieka.

## Zawartość

- [intent.md](intent.md): intencja, czyli problem, oczekiwany rezultat, ograniczenia i pytania otwarte.
- [spec.md](spec.md): specyfikacja, czyli przebieg i maszyna stanów, agenci, bramki, bezpieczeństwo, hooki, konfiguracja repozytorium, ewaluacje, porównanie frameworków, metryki i rollout.
- [plan.md](plan.md): plan techniczny MVP, czyli decyzje przy warunku zera kosztów, architektura, ochrona tokenu subskrypcji, przyrosty P0–P8, fazy po MVP i śledzenie wymagań.

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

## Autor

T. Stokłosa
