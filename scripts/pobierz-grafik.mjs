// Pobiera grafik zajęć Fight Club Champion (WodGuru) na najbliższe 7 dni
// i zapisuje do treningi.json tylko zajęcia prowadzone przez Kacpra.
// Uruchamiane automatycznie przez GitHub Actions (.github/workflows/grafik.yml).
// Ręcznie: node scripts/pobierz-grafik.mjs   (wymaga Node 18+)

import { writeFileSync, readFileSync, existsSync } from 'node:fs';

const CLUB = 'fightclubchampion';
const COACH = /Gruszczy[nń]ski/i;          // po tym rozpoznajemy zajęcia Kacpra
const DAYS = 7;
const OUT = 'treningi.json';
const API = `https://${CLUB}.wod.guru/registration/fetch-classes-for-guest`;
const SIGNUP = `https://wod.guru/pierwsze-zajecia/${CLUB}`;

// Data w strefie czasowej Polski (GitHub Actions działa w UTC)
function warsawDate(offsetDays) {
    const d = new Date(Date.now() + offsetDays * 86400000);
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw' }).format(d); // RRRR-MM-DD
}

const hhmm = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

async function fetchDay(date) {
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            const res = await fetch(API, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json;charset=utf-8', 'Accept': 'application/json' },
                body: JSON.stringify({ date, v: Date.now() }),
                signal: AbortSignal.timeout(15000)
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            if (!data.success || !Array.isArray(data.classes)) throw new Error('Nieoczekiwana odpowiedź');
            return data.classes;
        } catch (err) {
            console.warn(`${date}: próba ${attempt} nieudana – ${err.message}`);
            if (attempt === 3) throw err;
            await new Promise(r => setTimeout(r, 2000 * attempt));
        }
    }
}

const days = [];
let personal = false;

for (let i = 0; i < DAYS; i++) {
    const date = warsawDate(i);
    const classes = await fetchDay(date);
    const mine = classes.filter(c => (c.coaches || []).some(n => COACH.test(n)));

    // "Treningi Personalne" trwają cały dzień i mają wielu trenerów – pokazujemy je osobno
    if (mine.some(c => /personal/i.test(c.name))) personal = true;

    days.push({
        date,
        classes: mine
            .filter(c => !/personal/i.test(c.name))
            .map(c => ({
                name: c.name.replace(/\s+/g, ' ').trim(),
                start: hhmm(c.start_time),
                end: hhmm(c.end_time),
                room: (c.classroom || '').trim(),
                cancelled: Boolean(c.cancelled)
            }))
            .sort((a, b) => a.start.localeCompare(b.start))
    });
}

const result = { source: SIGNUP, personal, days };

// Zapisujemy tylko gdy grafik się zmienił (żeby nie robić pustych commitów)
const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : null;
const same = prev && JSON.stringify({ ...prev, updated: undefined }) === JSON.stringify({ ...result, updated: undefined });
if (same) {
    console.log('Grafik bez zmian.');
} else {
    writeFileSync(OUT, JSON.stringify({ updated: new Date().toISOString(), ...result }, null, 2) + '\n');
    console.log(`Zapisano ${OUT}: ${days.reduce((n, d) => n + d.classes.length, 0)} zajęć w ${DAYS} dni.`);
}
