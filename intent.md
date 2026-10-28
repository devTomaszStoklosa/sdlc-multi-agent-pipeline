# Intencja: Wieloagentowy pipeline SDLC

**Autor:** T. Stokłosa  
**Status:** Szkic  
**Data:** 2026-10-26

---

## Problem
Ręczne procesy wytwarzania oprogramowania (planowanie, kodowanie, code review, wdrożenie) są czasochłonne, podatne na błędy ludzi i spowalniają cykle wydań. Potrzebny jest zautomatyzowany, kompleksowy pipeline SDLC, napędzany przez autonomicznych lub współpracujących agentów AI.

## Oczekiwany rezultat
Zaprojektowanie i wdrożenie systemu wieloagentowego, w którym wyspecjalizowani agenci AI (np. Planner, Developer, Reviewer, agent DevOps odpowiedzialny za wdrożenia) płynnie współpracują, aby automatycznie planować, tworzyć, recenzować, testować i wdrażać rozwiązania programistyczne zgodnie ze standardowymi praktykami SDLC.

## Użytkownicy i systemy, których to dotyczy
* **Repozytoria docelowe:** konfigurowalne dla dowolnego repozytorium w ekosystemie projektów firmy.
* **Użytkownicy:** programiści, Tech Leadzi, inżynierowie DevOps i Product Ownerzy.

## Ograniczenia
* **Bezpieczeństwo i kontrola dostępu:** agenci muszą przestrzegać uprawnień repozytoriów i bezpiecznie zarządzać sekretami (żadnych danych uwierzytelniających wpisanych na stałe w kodzie).
* **Jakość kodu i bramki jakości:** automatyczne code review i kontrole muszą wymuszać analizę statyczną, skany bezpieczeństwa oraz zaliczone testy jednostkowe i integracyjne przed wdrożeniem.
* **Człowiek w pętli:** krytyczne działania (takie jak wdrożenia produkcyjne lub decyzje architektoniczne o dużym wpływie) wymagają wyraźnej akceptacji człowieka.
* **Zgodność i zasady programowania:** cały kod i wszystkie działania systemu muszą ściśle spełniać wszystkie określone zasady programowania (np. SOLID, DRY, KISS, YAGNI, prawo Demeter) oraz wymienione wyżej bramki bezpieczeństwa i jakości, bez żadnych wyjątków.

## Otwarte pytania i alternatywy
  1. Jaki poziom autonomii preferujemy w pierwszym wydaniu (np. pełna automatyka do środowiska dev czy tylko utworzenie PR)?
  2. Który framework agentowy najlepiej pasuje do naszej istniejącej infrastruktury repozytoriów?
