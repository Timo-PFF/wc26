/* World Cup Prediction Pool — translations
 * ----------------------------------------------------------------------------
 * All translatable content lives here so index.html stays logic, not copy.
 * Loaded as a plain <script> before index.html's inline script, so these
 * top-level consts are visible to it as globals (no modules / build step —
 * it has to work as static files on GitHub Pages).
 *
 * Three tables + one helper:
 *   I18N      — UI chrome strings, per language. Functions for the ones that
 *               interpolate numbers/scores. To add a UI string, add the SAME
 *               key under both `en` and `de` (a missing key renders undefined).
 *   STAGE_DE  — German knockout-round names by ESPN stage slug. English uses
 *               the feed's own stage.label, so only German needs a table.
 *   DE_NAMES  — German country names by (language-neutral) 3-letter abbr.
 *   translatePlaceholder() — rewrites ESPN's patterned knockout placeholders
 *               ("Group A Winner" → "Sieger Gruppe A") into German.
 *
 * The language-aware glue that reads these (t(), stageLabel(), teamName())
 * stays in index.html, since it depends on the live LANG state there.
 */

const I18N = {
  en: {
    appTitle: '⚽ World Cup Prediction Pool', docTitle: 'World Cup Prediction Pool',
    tabWho: 'Login', tabPredict: 'Make picks', tabSchedule: 'Results', tabGroups: 'Groups', tabKnockout: 'Knockout', tabStandings: 'Standings',
    svTable: 'Table', svGame: 'By game', filtered: 'Filtered', clearFilter: 'Clear filter',
    thTeam: 'Team', thPlayed: 'Pl', thGoals: 'Goals (+/−)', h2hTitle: 'Head-to-head',
    noGroups: 'No group games found.',
    playAs: name => 'You play as <b>' + name + '</b>',
    retrievingLogin: 'Retrieving your login…',
    chooseLeague: 'Choose your league', selectLeague: '— select your league —',
    leagueRequired: 'Please select your league first.',
    whoLabel: 'Who are you?', selectName: '— select your name —',
    addLabel: 'New here? Create your account', addNamePlaceholder: 'Your name', addMe: 'Add me',
    passwordPlaceholder: 'Your password', leaguePasswordPlaceholder: 'League password',
    continueBtn: 'Login', showPw: 'Show', hidePw: 'Hide',
    needPassword: 'Please enter a password.', badPassword: 'Wrong password.',
    badLeaguePassword: 'Wrong league password.',
    loginFirst: 'Select your name and log in first.',
    loginRequired: 'Log in on the Login tab to see this.',
    addErrEmpty: 'Please enter a name.',
    addErrDuplicate: 'That name has already joined — pick it above and enter its password.',
    addFailed: 'Could not create the account. Please try again.',
    viewLabel: 'View:', byGroup: 'By group', chronological: 'Chronological',
    reloadData: '↻ Reload data', liveScores: '⚡ Live scores', logout: 'Logout',
    loadingMatches: 'Loading matches…', loading: 'Loading…',
    nowLabel: 'Now:', hideStarted: 'Hide started games', showLabel: 'Show:', showPicks: 'show picks',
    countdown: (d, h, m, s) => 'Starts in ' +
      (d > 0 ? d + 'd ' + h + 'h' : h > 0 ? h + 'h ' + m + 'm' : m + 'm ' + s + 's'),
    onlyUpcoming: h => 'Show only upcoming games (' + h + 'h)',
    onlyNoPicks: 'Show only games without picks',
    noUpcomingMatch: 'No games match the filters.',
    qbShowAll: 'Show all', qbHideAll: 'Hide all', qbGroupStage: 'Group stage', qbKnockouts: 'Knockouts',
    startedLocked: 'Kicked off — picks locked', allStarted: 'No upcoming games to pick.',
    penaltyWinner: 'Penalty winner:', pickPenaltyWinner: 'Pick a penalty winner for your drawn knockout games.',
    allHidden: 'All groups hidden — tap a chip above to show one.',
    submit: 'Submit my picks',
    thRank: '#', thPlayer: 'Player', thPts: 'Pts', thExact: 'Exact', thGd: 'GD', thGame: 'Game', thGuess: 'Guess', total: 'Total',
    pointsChartTitle: 'Cumulative points', start: 'Start',
    completedGames: n => n + ' completed game(s)',
    inProgress: n => ' + ' + n + (n === 1 ? ' game' : ' games') + ' in progress',
    liFetched: (n, time) => 'Fetched ' + n + (n === 1 ? ' live game' : ' live games') + ' at ' + time + ':',
    liOngoing: 'on-going', liFinished: 'finished',
    noCompleted: 'No completed games yet.',
    couldNotLoadSchedule: 'Could not load the schedule.',
    setScriptUrl: '⚠ Set SCRIPT_URL in index.html first (see SETUP.md).',
    couldNotLoadFixtures: url => 'Could not load ' + url + '.',
    couldNotLoadPlayers: 'Could not load the player list — check SCRIPT_URL and that access is "Anyone".',
    noMatches: 'No matches set up yet.',
    matchCount: n => n + ' match(es)',
    finalLocked: (h, a) => 'Final: ' + h + '–' + a + ' (picks locked)',
    wonOnPens: (team, w, l) => team + ' win ' + w + ':' + l + ' on penalties',
    wonOnPensNoScore: team => team + ' win on penalties',
    afterExtraTime: 'a.e.t.',
    liveLabel: 'LIVE',
    penTag: (w, l) => 'pens ' + w + '–' + l,
    penTagPlain: 'pens',
    noKnockout: 'No knockout games yet.',
    vs: 'vs',
    scoringRules: (g, k) =>
      '<h2 class="rules-title">Scoring rules</h2>' +
      '<div class="rules-sub">Group stage</div>' +
      '<ul class="rules-list">' +
        '<li><b>' + g.exact + '</b> — exact score (incl. exact draw)</li>' +
        '<li><b>' + g.goalDifference + '</b> — correct winner + goal difference</li>' +
        '<li><b>' + g.outcome + '</b> — correct winner, or a correctly predicted draw</li>' +
        '<li><b>0</b> — otherwise</li>' +
      '</ul>' +
      '<div class="rules-sub">Knockout stage</div>' +
      '<p class="rules-note">You predict either an outright winner or a draw — and for a draw you also pick who wins the shootout. The number of penalties scored never matters: only the result after 90/120 minutes and, if it goes that far, which team wins on penalties.</p>' +
      '<div class="rules-mode">If you predict an outright <b>winner</b>:</div>' +
      '<ul class="rules-list">' +
        '<li><b>' + k.exact + '</b> — exact score (before penalties)</li>' +
        '<li><b>' + k.goalDifference + '</b> — correct winner + goal difference</li>' +
        '<li><b>' + k.winner + '</b> — correct winner</li>' +
        '<li><b>' + k.shootoutCalled + '</b> — it went to penalties and the team you picked won the shootout</li>' +
        '<li><b>0</b> — wrong winner</li>' +
      '</ul>' +
      '<div class="rules-mode">If you predict a <b>draw</b> (and pick a penalty winner):</div>' +
      '<ul class="rules-list">' +
        '<li><b>' + k.drawBase + '</b> — it really was a draw after extra time</li>' +
        '<li><b>+' + k.drawExactBonus + '</b> — your exact score (after extra time) was right</li>' +
        '<li><b>+' + k.drawPenBonus + '</b> — you also picked the correct penalty winner (so a perfect call = ' + (k.drawBase + k.drawExactBonus + k.drawPenBonus) + ')</li>' +
        '<li><b>' + k.penWinnerDecisive + '</b> — the game was decided in normal/extra time, but the team you picked on penalties is the one that advanced</li>' +
        '<li><b>0</b> — otherwise</li>' +
      '</ul>' +
      '<p class="rules-note">Standings tie-break: most exact-score hits, then goal-difference hits.</p>',
    selectNameFirst: 'Please select your name first.',
    enterScore: 'Enter at least one score before submitting.',
    saving: 'Saving…',
    saved: n => 'Saved ' + n + ' pick(s)! Change them any time before kickoff.',
    errorPrefix: e => 'Error: ' + e, unknown: 'unknown',
    networkError: 'Network error — could not save. Try again.',
    submitErrNotJoined: 'Add your name first, then make your picks.',
    setScriptUrlFirst: 'Set SCRIPT_URL first.',
    matchesScored: n => n + ' match(es) scored so far.',
    noPlayers: 'No players yet.',
    couldNotLoadStandings: 'Could not load standings.',
    group: 'Group', groupStageTBD: 'Group Stage (TBD)', dateTBD: 'Date TBD',
  },
  de: {
    appTitle: '⚽ WM-Tippspiel', docTitle: 'WM-Tippspiel',
    tabWho: 'Login', tabPredict: 'Tippen', tabSchedule: 'Ergebnisse', tabGroups: 'Gruppen', tabKnockout: 'K.-o.-Runde', tabStandings: 'Tabelle',
    svTable: 'Tabelle', svGame: 'Nach Spiel', filtered: 'Gefiltert', clearFilter: 'Filter entfernen',
    thTeam: 'Team', thPlayed: 'Sp', thGoals: 'Tore (+/−)', h2hTitle: 'Direkter Vergleich',
    noGroups: 'Keine Gruppenspiele gefunden.',
    playAs: name => 'Du spielst als <b>' + name + '</b>',
    retrievingLogin: 'Anmeldung läuft …',
    chooseLeague: 'Wähle deine Liga', selectLeague: '— Liga auswählen —',
    leagueRequired: 'Bitte zuerst deine Liga wählen.',
    whoLabel: 'Wer bist du?', selectName: '— wähle deinen Namen —',
    addLabel: 'Neu hier? Konto erstellen', addNamePlaceholder: 'Dein Name', addMe: 'Hinzufügen',
    passwordPlaceholder: 'Dein Passwort', leaguePasswordPlaceholder: 'Liga-Passwort',
    continueBtn: 'Login', showPw: 'Zeigen', hidePw: 'Verbergen',
    needPassword: 'Bitte ein Passwort eingeben.', badPassword: 'Falsches Passwort.',
    badLeaguePassword: 'Falsches Liga-Passwort.',
    loginFirst: 'Wähle zuerst deinen Namen und melde dich an.',
    loginRequired: 'Melde dich im Tab „Login" an, um das zu sehen.',
    addErrEmpty: 'Bitte einen Namen eingeben.',
    addErrDuplicate: 'Dieser Name ist schon dabei — wähle ihn oben und gib das Passwort ein.',
    addFailed: 'Konto konnte nicht erstellt werden. Bitte erneut versuchen.',
    viewLabel: 'Ansicht:', byGroup: 'Nach Gruppe', chronological: 'Chronologisch',
    reloadData: '↻ Daten neu laden', liveScores: '⚡ Live-Ergebnisse', logout: 'Logout',
    loadingMatches: 'Spiele werden geladen…', loading: 'Wird geladen…',
    nowLabel: 'Jetzt:', hideStarted: 'Begonnene ausblenden', showLabel: 'Anzeigen:', showPicks: 'Tipps anzeigen',
    countdown: (d, h, m, s) => 'Beginnt in ' +
      (d > 0 ? d + ' T ' + h + ' Std' : h > 0 ? h + ' Std ' + m + ' Min' : m + ' Min ' + s + ' Sek'),
    onlyUpcoming: h => 'Nur anstehende Spiele (' + h + ' Std)',
    onlyNoPicks: 'Nur Spiele ohne Tipp',
    noUpcomingMatch: 'Keine Spiele entsprechen den Filtern.',
    qbShowAll: 'Alle anzeigen', qbHideAll: 'Alle ausblenden', qbGroupStage: 'Gruppenphase', qbKnockouts: 'K.-o.-Runden',
    startedLocked: 'Angepfiffen — Tipps gesperrt', allStarted: 'Keine anstehenden Spiele zum Tippen.',
    penaltyWinner: 'Elfmeter-Sieger:', pickPenaltyWinner: 'Wähle bei deinen K.-o.-Remis einen Elfmeter-Sieger.',
    allHidden: 'Alle Gruppen ausgeblendet — tippe oben auf einen Chip.',
    submit: 'Tipps absenden',
    thRank: '#', thPlayer: 'Spieler', thPts: 'Pkt', thExact: 'Exakt', thGd: 'TD', thGame: 'Spiel', thGuess: 'Tipp', total: 'Gesamt',
    pointsChartTitle: 'Punkteverlauf', start: 'Start',
    completedGames: n => n + (n === 1 ? ' abgeschlossenes Spiel' : ' abgeschlossene Spiele'),
    inProgress: n => ' + ' + n + (n === 1 ? ' laufendes Spiel' : ' laufende Spiele'),
    liFetched: (n, time) => n + (n === 1 ? ' Live-Spiel' : ' Live-Spiele') + ' um ' + time + ' abgerufen:',
    liOngoing: 'läuft', liFinished: 'beendet',
    noCompleted: 'Noch keine abgeschlossenen Spiele.',
    couldNotLoadSchedule: 'Spielplan konnte nicht geladen werden.',
    setScriptUrl: '⚠ Zuerst SCRIPT_URL in index.html setzen (siehe SETUP.md).',
    couldNotLoadFixtures: url => url + ' konnte nicht geladen werden.',
    couldNotLoadPlayers: 'Spielerliste konnte nicht geladen werden — prüfe SCRIPT_URL und ob der Zugriff auf „Anyone" steht.',
    noMatches: 'Noch keine Spiele angelegt.',
    matchCount: n => n + (n === 1 ? ' Spiel' : ' Spiele'),
    finalLocked: (h, a) => 'Endstand: ' + h + '–' + a + ' (Tipps gesperrt)',
    wonOnPens: (team, w, l) => team + ' gewinnt ' + w + ':' + l + ' im Elfmeterschießen',
    wonOnPensNoScore: team => team + ' gewinnt im Elfmeterschießen',
    afterExtraTime: 'n.V.',
    liveLabel: 'LIVE',
    penTag: (w, l) => 'i.E. ' + w + '–' + l,
    penTagPlain: 'i.E.',
    noKnockout: 'Noch keine K.-o.-Spiele.',
    vs: 'gegen',
    scoringRules: (g, k) =>
      '<h2 class="rules-title">Wertung</h2>' +
      '<div class="rules-sub">Gruppenphase</div>' +
      '<ul class="rules-list">' +
        '<li><b>' + g.exact + '</b> — exaktes Ergebnis (inkl. exaktes Remis)</li>' +
        '<li><b>' + g.goalDifference + '</b> — richtiger Sieger + Tordifferenz</li>' +
        '<li><b>' + g.outcome + '</b> — richtiger Sieger oder korrekt getipptes Remis</li>' +
        '<li><b>0</b> — sonst</li>' +
      '</ul>' +
      '<div class="rules-sub">K.-o.-Phase</div>' +
      '<p class="rules-note">Du tippst entweder einen Sieger oder ein Remis — beim Remis wählst du zusätzlich, wer das Elfmeterschießen gewinnt. Die Anzahl der verwandelten Elfmeter zählt nie: nur das Ergebnis nach 90/120 Minuten und, falls es so weit kommt, welches Team im Elfmeterschießen gewinnt.</p>' +
      '<div class="rules-mode">Wenn du einen <b>Sieger</b> tippst:</div>' +
      '<ul class="rules-list">' +
        '<li><b>' + k.exact + '</b> — exaktes Ergebnis (vor dem Elfmeterschießen)</li>' +
        '<li><b>' + k.goalDifference + '</b> — richtiger Sieger + Tordifferenz</li>' +
        '<li><b>' + k.winner + '</b> — richtiger Sieger</li>' +
        '<li><b>' + k.shootoutCalled + '</b> — es ging ins Elfmeterschießen und dein getipptes Team hat gewonnen</li>' +
        '<li><b>0</b> — falscher Sieger</li>' +
      '</ul>' +
      '<div class="rules-mode">Wenn du ein <b>Remis</b> tippst (und einen Elfmeter-Sieger wählst):</div>' +
      '<ul class="rules-list">' +
        '<li><b>' + k.drawBase + '</b> — es war wirklich ein Remis nach Verlängerung</li>' +
        '<li><b>+' + k.drawExactBonus + '</b> — dein exaktes Ergebnis (nach Verlängerung) stimmt</li>' +
        '<li><b>+' + k.drawPenBonus + '</b> — du hast auch den richtigen Elfmeter-Sieger getippt (perfekter Tipp = ' + (k.drawBase + k.drawExactBonus + k.drawPenBonus) + ')</li>' +
        '<li><b>' + k.penWinnerDecisive + '</b> — das Spiel wurde in regulärer Zeit/Verlängerung entschieden, aber das von dir beim Elfmeterschießen gewählte Team ist weitergekommen</li>' +
        '<li><b>0</b> — sonst</li>' +
      '</ul>' +
      '<p class="rules-note">Gleichstand in der Tabelle: meiste exakte Tipps, dann Tordifferenz-Treffer.</p>',
    selectNameFirst: 'Bitte zuerst deinen Namen wählen.',
    enterScore: 'Gib mindestens ein Ergebnis ein, bevor du absendest.',
    saving: 'Wird gespeichert…',
    saved: n => n + ' Tipp(s) gespeichert! Du kannst sie bis zum Anpfiff jederzeit ändern.',
    errorPrefix: e => 'Fehler: ' + e, unknown: 'unbekannt',
    networkError: 'Netzwerkfehler — konnte nicht speichern. Bitte erneut versuchen.',
    submitErrNotJoined: 'Füge zuerst deinen Namen hinzu, dann tippe.',
    setScriptUrlFirst: 'Zuerst SCRIPT_URL setzen.',
    matchesScored: n => n + (n === 1 ? ' Spiel' : ' Spiele') + ' bisher gewertet.',
    noPlayers: 'Noch keine Spieler.',
    couldNotLoadStandings: 'Tabelle konnte nicht geladen werden.',
    group: 'Gruppe', groupStageTBD: 'Gruppenphase (offen)', dateTBD: 'Datum offen',
  },
};

// German knockout-round names, keyed by ESPN stage slug.
const STAGE_DE = {
  'group-stage': 'Gruppenphase', 'round-of-32': 'Sechzehntelfinale',
  'round-of-16': 'Achtelfinale', 'quarterfinals': 'Viertelfinale',
  'semifinals': 'Halbfinale', '3rd-place-match': 'Spiel um Platz 3', 'final': 'Finale',
};

// German country names by 3-letter abbreviation, for all 48 qualified teams.
// Anything not listed (a knockout placeholder, or a team that hasn't qualified)
// falls back to the English name, or to a translated placeholder.
const DE_NAMES = {
  ALG: 'Algerien', ARG: 'Argentinien', AUS: 'Australien', AUT: 'Österreich',
  BEL: 'Belgien', BIH: 'Bosnien und Herzegowina', BRA: 'Brasilien', CAN: 'Kanada',
  CIV: 'Elfenbeinküste', COD: 'DR Kongo', COL: 'Kolumbien', CPV: 'Kap Verde',
  CRO: 'Kroatien', CUW: 'Curaçao', CZE: 'Tschechien', ECU: 'Ecuador',
  EGY: 'Ägypten', ENG: 'England', ESP: 'Spanien', FRA: 'Frankreich',
  GER: 'Deutschland', GHA: 'Ghana', HAI: 'Haiti', IRN: 'Iran', IRQ: 'Irak',
  JOR: 'Jordanien', JPN: 'Japan', KOR: 'Südkorea', KSA: 'Saudi-Arabien',
  MAR: 'Marokko', MEX: 'Mexiko', NED: 'Niederlande', NOR: 'Norwegen',
  NZL: 'Neuseeland', PAN: 'Panama', PAR: 'Paraguay', POR: 'Portugal',
  QAT: 'Katar', RSA: 'Südafrika', SCO: 'Schottland', SEN: 'Senegal',
  SUI: 'Schweiz', SWE: 'Schweden', TUN: 'Tunesien', TUR: 'Türkei',
  URU: 'Uruguay', USA: 'USA', UZB: 'Usbekistan',
};

// Knockout slots arrive as English placeholders ("Group A Winner", "Round of
// 32 3 Winner", …) until the bracket fills. Translate the known patterns;
// return null for anything unrecognised so the caller keeps the English text.
function translatePlaceholder(name) {
  if (!name) return null;
  let m;
  if ((m = name.match(/^Group ([A-L]) Winner$/)))        return 'Sieger Gruppe ' + m[1];
  if ((m = name.match(/^Group ([A-L]) 2nd Place$/)))     return 'Zweiter Gruppe ' + m[1];
  if ((m = name.match(/^Third Place Group (.+)$/)))       return 'Gruppendritter ' + m[1];
  if ((m = name.match(/^Round of 32 (\d+) Winner$/)))    return 'Sieger Sechzehntelfinale ' + m[1];
  if ((m = name.match(/^Round of 16 (\d+) Winner$/)))    return 'Sieger Achtelfinale ' + m[1];
  if ((m = name.match(/^Quarterfinal (\d+) Winner$/)))   return 'Sieger Viertelfinale ' + m[1];
  if ((m = name.match(/^Semifinal (\d+) Winner$/)))      return 'Sieger Halbfinale ' + m[1];
  if ((m = name.match(/^Semifinal (\d+) Loser$/)))       return 'Verlierer Halbfinale ' + m[1];
  return null;
}
