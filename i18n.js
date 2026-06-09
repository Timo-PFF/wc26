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
    subtitle: 'Pick scores, earn points, win bragging rights.',
    tabWho: 'Player', tabPredict: 'Make picks', tabSchedule: 'Results', tabGroups: 'Groups', tabStandings: 'Standings',
    svTable: 'Table', svGame: 'By game', filtered: 'Filtered', clearFilter: 'Clear filter',
    thTeam: 'Team', thPlayed: 'Pl', thGoals: 'Goals (+/−)', h2hTitle: 'Head-to-head',
    noGroups: 'No group games found.',
    playAs: name => 'You play as <b>' + name + '</b>',
    retrievingLogin: 'Retrieving your login…',
    whoLabel: 'Who are you?', selectName: '— select your name —',
    addLabel: 'New here? Add your name + password', addNamePlaceholder: 'Your name', addMe: 'Add me',
    passwordPlaceholder: 'Password', continueBtn: 'Login', showPw: 'Show', hidePw: 'Hide',
    needPassword: 'Please enter a password.', badPassword: 'Wrong password.',
    loginFirst: 'Select your name and log in first.',
    loginRequired: 'Log in on the Player tab to see this.',
    addErrEmpty: 'Please enter a name.',
    addErrNotEligible: 'That name isn’t on the invite list — ask the organizer to add it.',
    addErrDuplicate: 'That name has already joined — pick it above and enter its password.',
    addFailed: 'Could not add the name. Please try again.',
    viewLabel: 'View:', byGroup: 'By group', chronological: 'Chronological',
    langLabel: 'Language:', reloadData: '↻ Reload data', logout: 'Logout',
    loadingMatches: 'Loading matches…', loading: 'Loading…',
    nowLabel: 'Now:', hideStarted: 'Hide started games', showLabel: 'Show:', showPicks: 'show picks',
    countdown: (d, h, m, s) => 'Starts in ' +
      (d > 0 ? d + 'd ' + h + 'h' : h > 0 ? h + 'h ' + m + 'm' : m + 'm ' + s + 's'),
    onlyUpcoming: h => 'Show only upcoming games (' + h + 'h)',
    onlyNoPicks: 'Show only games without picks',
    noUpcomingMatch: 'No games match the filters.',
    qbShowAll: 'Show all', qbHideAll: 'Hide all', qbGroupStage: 'Group stage', qbKnockouts: 'Knockouts',
    startedLocked: 'Kicked off — picks locked', allStarted: 'No upcoming games to pick.',
    allHidden: 'All groups hidden — tap a chip above to show one.',
    submit: 'Submit my picks',
    thRank: '#', thPlayer: 'Player', thPts: 'Pts', thExact: 'Exact', thGd: 'GD', thGame: 'Game', thGuess: 'Guess', total: 'Total',
    pointsChartTitle: 'Cumulative points', start: 'Start',
    completedGames: n => n + ' completed game(s)',
    noCompleted: 'No completed games yet.',
    couldNotLoadSchedule: 'Could not load the schedule.',
    footer: 'Family & friends pool · refresh standings any time',
    setScriptUrl: '⚠ Set SCRIPT_URL in index.html first (see SETUP.md).',
    couldNotLoadFixtures: url => 'Could not load ' + url + '.',
    couldNotLoadPlayers: 'Could not load the player list — check SCRIPT_URL and that access is "Anyone".',
    noMatches: 'No matches set up yet.',
    matchCount: n => n + ' match(es)',
    finalLocked: (h, a) => 'Final: ' + h + '–' + a + ' (picks locked)',
    vs: 'vs',
    scoringNote: (x, g, o) => 'Scoring: <b>' + x + '</b> exact score · <b>' + g +
      '</b> right winner + goal difference · <b>' + o +
      '</b> right winner or correct draw · tie-break by exact hits.',
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
    subtitle: 'Tippe Ergebnisse, sammle Punkte, gewinne Ruhm.',
    tabWho: 'Spieler', tabPredict: 'Tippen', tabSchedule: 'Ergebnisse', tabGroups: 'Gruppen', tabStandings: 'Tabelle',
    svTable: 'Tabelle', svGame: 'Nach Spiel', filtered: 'Gefiltert', clearFilter: 'Filter entfernen',
    thTeam: 'Team', thPlayed: 'Sp', thGoals: 'Tore (+/−)', h2hTitle: 'Direkter Vergleich',
    noGroups: 'Keine Gruppenspiele gefunden.',
    playAs: name => 'Du spielst als <b>' + name + '</b>',
    retrievingLogin: 'Anmeldung läuft …',
    whoLabel: 'Wer bist du?', selectName: '— wähle deinen Namen —',
    addLabel: 'Neu hier? Name + Passwort hinzufügen', addNamePlaceholder: 'Dein Name', addMe: 'Hinzufügen',
    passwordPlaceholder: 'Passwort', continueBtn: 'Login', showPw: 'Zeigen', hidePw: 'Verbergen',
    needPassword: 'Bitte ein Passwort eingeben.', badPassword: 'Falsches Passwort.',
    loginFirst: 'Wähle zuerst deinen Namen und melde dich an.',
    loginRequired: 'Melde dich im Tab „Spieler" an, um das zu sehen.',
    addErrEmpty: 'Bitte einen Namen eingeben.',
    addErrNotEligible: 'Dieser Name steht nicht auf der Einladungsliste — bitte den Organisator, ihn hinzuzufügen.',
    addErrDuplicate: 'Dieser Name ist schon dabei — wähle ihn oben und gib das Passwort ein.',
    addFailed: 'Name konnte nicht hinzugefügt werden. Bitte erneut versuchen.',
    viewLabel: 'Ansicht:', byGroup: 'Nach Gruppe', chronological: 'Chronologisch',
    langLabel: 'Sprache:', reloadData: '↻ Daten neu laden', logout: 'Logout',
    loadingMatches: 'Spiele werden geladen…', loading: 'Wird geladen…',
    nowLabel: 'Jetzt:', hideStarted: 'Begonnene ausblenden', showLabel: 'Anzeigen:', showPicks: 'Tipps anzeigen',
    countdown: (d, h, m, s) => 'Beginnt in ' +
      (d > 0 ? d + ' T ' + h + ' Std' : h > 0 ? h + ' Std ' + m + ' Min' : m + ' Min ' + s + ' Sek'),
    onlyUpcoming: h => 'Nur anstehende Spiele (' + h + ' Std)',
    onlyNoPicks: 'Nur Spiele ohne Tipp',
    noUpcomingMatch: 'Keine Spiele entsprechen den Filtern.',
    qbShowAll: 'Alle anzeigen', qbHideAll: 'Alle ausblenden', qbGroupStage: 'Gruppenphase', qbKnockouts: 'K.-o.-Runden',
    startedLocked: 'Angepfiffen — Tipps gesperrt', allStarted: 'Keine anstehenden Spiele zum Tippen.',
    allHidden: 'Alle Gruppen ausgeblendet — tippe oben auf einen Chip.',
    submit: 'Tipps absenden',
    thRank: '#', thPlayer: 'Spieler', thPts: 'Pkt', thExact: 'Exakt', thGd: 'TD', thGame: 'Spiel', thGuess: 'Tipp', total: 'Gesamt',
    pointsChartTitle: 'Punkteverlauf', start: 'Start',
    completedGames: n => n + (n === 1 ? ' abgeschlossenes Spiel' : ' abgeschlossene Spiele'),
    noCompleted: 'Noch keine abgeschlossenen Spiele.',
    couldNotLoadSchedule: 'Spielplan konnte nicht geladen werden.',
    footer: 'Pool für Familie & Freunde · Tabelle jederzeit aktualisieren',
    setScriptUrl: '⚠ Zuerst SCRIPT_URL in index.html setzen (siehe SETUP.md).',
    couldNotLoadFixtures: url => url + ' konnte nicht geladen werden.',
    couldNotLoadPlayers: 'Spielerliste konnte nicht geladen werden — prüfe SCRIPT_URL und ob der Zugriff auf „Anyone" steht.',
    noMatches: 'Noch keine Spiele angelegt.',
    matchCount: n => n + (n === 1 ? ' Spiel' : ' Spiele'),
    finalLocked: (h, a) => 'Endstand: ' + h + '–' + a + ' (Tipps gesperrt)',
    vs: 'gegen',
    scoringNote: (x, g, o) => 'Wertung: <b>' + x + '</b> exaktes Ergebnis · <b>' + g +
      '</b> Sieger + Tordifferenz · <b>' + o +
      '</b> richtiger Sieger oder richtiges Remis · Gleichstand: meiste exakte Tipps.',
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
