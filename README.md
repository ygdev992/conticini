# Conticini

PWA minimale per gestire i conti di casa: scadenze, vista mensile e calcolo dei giroconti.

## Regole di dominio
- Tutto è comune, divisione 50/50 (regola configurabile in futuro).
- Il conto cointestato è un "pozzo comune": le sue uscite sono già di entrambi.
- La carta di credito familiare si addebita il giorno 5 del mese successivo sul conto del titolare; si registra il totale mensile (voci singole opzionali).
- I prestiti hanno rate totali/rimanenti.
- Sviluppo locale prima, cloud solo alla fine. Niente notifiche push: solo evidenza visiva in app.

## Cloud (opzionale)
1. Crea un progetto su Supabase, esegui `supabase/schema.sql` nello SQL Editor.
2. In Authentication → Providers → Email disattiva "Confirm email" e, dopo che vi siete registrati in due, disattiva le nuove registrazioni.
3. Copia Project URL e anon key in `config.js`. Con i campi vuoti l'app resta solo locale.
4. Pubblica la cartella su GitHub Pages (HTTPS, necessario per installare la PWA).
