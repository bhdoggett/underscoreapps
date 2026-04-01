import { useReducer, useEffect, useState, Fragment } from 'react'
import AppHeader from '../../components/AppHeader'
import { useIsLandscapeMobile } from '../../hooks/useIsLandscapeMobile'
import styles from './DartsApp.module.css'

const STORAGE_KEY = '_apps.darts.v1'

const NAMES = [
  'Aldric', 'Bramble', 'Corvus', 'Draven', 'Ember',
  'Fawkes', 'Grimble', 'Huxley', 'Isolde', 'Jasper',
  'Kael', 'Lyric', 'Mireille', 'Nox', 'Orin',
  'Pyre', 'Quinn', 'Rook', 'Sage', 'Thane',
  'Urko', 'Vex', 'Wren', 'Xan', 'Yari',
  'Zed', 'Brom', 'Caelum', 'Dusk', 'Flint',
  'Gorm', 'Hex', 'Jax', 'Kira', 'Lorn',
  'Mist', 'Nara', 'Oken', 'Pell', 'Sable',
]

function pickName(used: string[]): string {
  const pool = NAMES.filter(n => !used.includes(n))
  const src = pool.length > 0 ? pool : NAMES
  return src[Math.floor(Math.random() * src.length)]
}

type Phase = 'setup' | 'play' | 'done'
type Player = { id: string; name: string }
type TurnRecord = { score: number; bust: boolean }
type Leg = { scores: Record<string, TurnRecord[]>; winner: string | null }

type State = {
  phase: Phase
  startScore: 301 | 501 | 701
  legCount: 1 | 3 | 5
  players: Player[]
  legs: Leg[]
  currentLeg: number
  activePlayer: number
}

type Action =
  | { type: 'SET_START_SCORE'; score: 301 | 501 | 701 }
  | { type: 'SET_LEG_COUNT'; count: 1 | 3 | 5 }
  | { type: 'ADD_PLAYER' }
  | { type: 'REMOVE_PLAYER'; id: string }
  | { type: 'RENAME_PLAYER'; id: string; name: string }
  | { type: 'START' }
  | { type: 'ENTER_SCORE'; score: number; bust: boolean }
  | { type: 'EDIT_TURN'; playerId: string; turnIndex: number; score: number; bust: boolean }
  | { type: 'NEXT_LEG' }
  | { type: 'NEW_GAME' }

function emptyLeg(players: Player[]): Leg {
  const scores: Record<string, TurnRecord[]> = {}
  for (const p of players) scores[p.id] = []
  return { scores, winner: null }
}

const initial: State = {
  phase: 'setup',
  startScore: 501,
  legCount: 1,
  players: [],
  legs: [],
  currentLeg: 0,
  activePlayer: 0,
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'SET_START_SCORE':
      return { ...state, startScore: action.score }
    case 'SET_LEG_COUNT':
      return { ...state, legCount: action.count }
    case 'ADD_PLAYER': {
      const name = pickName(state.players.map(p => p.name))
      return { ...state, players: [...state.players, { id: crypto.randomUUID(), name }] }
    }
    case 'REMOVE_PLAYER':
      return { ...state, players: state.players.filter(p => p.id !== action.id) }
    case 'RENAME_PLAYER':
      return { ...state, players: state.players.map(p => p.id === action.id ? { ...p, name: action.name } : p) }
    case 'START':
      if (state.players.length === 0) return state
      return { ...state, phase: 'play', legs: [emptyLeg(state.players)], currentLeg: 0, activePlayer: 0 }
    case 'ENTER_SCORE': {
      const leg = state.legs[state.currentLeg]
      const player = state.players[state.activePlayer]
      const newTurn: TurnRecord = { score: action.score, bust: action.bust }
      const newScores = {
        ...leg.scores,
        [player.id]: [...leg.scores[player.id], newTurn],
      }
      const remaining = state.startScore - newScores[player.id].filter(t => !t.bust).reduce((s, t) => s + t.score, 0)
      const winner = remaining === 0 ? player.id : null
      const newLeg: Leg = { scores: newScores, winner }
      const nextPlayer = (state.activePlayer + 1) % state.players.length
      return {
        ...state,
        legs: state.legs.map((l, i) => i === state.currentLeg ? newLeg : l),
        activePlayer: winner ? state.activePlayer : nextPlayer,
      }
    }
    case 'NEXT_LEG': {
      const nextLegIdx = state.currentLeg + 1
      const legsWon = (id: string) => state.legs.filter(l => l.winner === id).length
      const maxWins = Math.ceil(state.legCount / 2)
      const matchWinner = state.players.find(p => legsWon(p.id) >= maxWins)
      if (matchWinner || nextLegIdx >= state.legCount) {
        return { ...state, phase: 'done' }
      }
      return {
        ...state,
        currentLeg: nextLegIdx,
        activePlayer: nextLegIdx % state.players.length,
        legs: [...state.legs, emptyLeg(state.players)],
      }
    }
    case 'EDIT_TURN': {
      const leg = state.legs[state.currentLeg]
      const newTurns = leg.scores[action.playerId].map((t, i) =>
        i === action.turnIndex ? { score: action.score, bust: action.bust } : t
      )
      const newScores = { ...leg.scores, [action.playerId]: newTurns }
      const rem = state.startScore - newTurns.filter(t => !t.bust).reduce((s, t) => s + t.score, 0)
      const winner = rem === 0 ? action.playerId : (leg.winner !== action.playerId ? leg.winner : null)
      return {
        ...state,
        legs: state.legs.map((l, i) => i === state.currentLeg ? { scores: newScores, winner } : l),
      }
    }
    case 'NEW_GAME':
      return { ...initial }
    default:
      return state
  }
}

function remainingBefore(state: State, playerId: string, turnIndex: number): number {
  const leg = state.legs[state.currentLeg]
  if (!leg) return state.startScore
  const turns = leg.scores[playerId] ?? []
  return state.startScore - turns.slice(0, turnIndex).filter(t => !t.bust).reduce((s, t) => s + t.score, 0)
}

function remaining(state: State, playerId: string): number {
  const leg = state.legs[state.currentLeg]
  if (!leg) return state.startScore
  const turns = leg.scores[playerId] ?? []
  const scored = turns.filter(t => !t.bust).reduce((s, t) => s + t.score, 0)
  return state.startScore - scored
}

function legWins(state: State, playerId: string): number {
  return state.legs.filter(l => l.winner === playerId).length
}

function loadState(): State {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return initial
    const parsed = JSON.parse(raw)
    if (parsed?.v !== 1 || !parsed.state) return initial
    return parsed.state as State
  } catch {
    return initial
  }
}

const QUICK_SCORES = [26, 45, 60, 100, 140, 180]

const about = (
  <>
    <p>Track scores for a game of 301, 501, or 701 darts.</p>
    <ul>
      <li>Players start at the chosen score and count down to zero</li>
      <li>Each turn, throw 3 darts and enter the total</li>
      <li>You must reach <strong>exactly 0</strong> — the finishing dart must land on a double or the bullseye</li>
      <li>If a score would take you below 0, or leave you on 1, it's a <strong>bust</strong> — your score stays the same</li>
      <li>First to reach 0 wins the leg; win the match by winning the most legs</li>
    </ul>
  </>
)

export default function DartsApp() {
  const isLandscapeMobile = useIsLandscapeMobile()
  const [state, dispatch] = useReducer(reducer, undefined, loadState)
  const { phase, startScore, legCount, players, legs, currentLeg, activePlayer } = state
  const [pickerOpen, setPickerOpen] = useState(false)
  const [editCell, setEditCell] = useState<{ playerId: string; turnIndex: number } | null>(null)
  const [customVal, setCustomVal] = useState('')

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, state }))
  }, [state])

  useEffect(() => {
    if (!pickerOpen) {
      setCustomVal('')
      setEditCell(null)
    }
  }, [pickerOpen])

  const pickerRemaining = editCell
    ? remainingBefore(state, editCell.playerId, editCell.turnIndex)
    : remaining(state, players[activePlayer]?.id ?? '')

  const pickerPlayer = editCell
    ? players.find(p => p.id === editCell.playerId) ?? players[activePlayer]
    : players[activePlayer]

  function submitScore(score: number, bust: boolean) {
    if (editCell) {
      dispatch({ type: 'EDIT_TURN', playerId: editCell.playerId, turnIndex: editCell.turnIndex, score, bust })
    } else {
      dispatch({ type: 'ENTER_SCORE', score, bust })
    }
    setPickerOpen(false)
  }

  function handleCustomOk() {
    const n = parseInt(customVal)
    if (n >= 0 && n <= 180) {
      const isBust = n > pickerRemaining || pickerRemaining - n === 1
      submitScore(isBust ? 0 : n, isBust)
    }
  }

  const currentLegData = legs[currentLeg]
  const currentPlayer = players[activePlayer]
  const legWon = currentLegData?.winner != null

  // ── Setup ─────────────────────────────────────────────────────────────────
  if (phase === 'setup') {
    return (
      <div className={styles.app}>
        <AppHeader title="darts" about={about} />
        <div className={styles.content}>
          <div className={styles.section}>
            <div className={styles.label}>starting score</div>
            <div className={styles.toggle}>
              {([301, 501, 701] as const).map(s => (
                <button
                  key={s}
                  className={[styles.toggleBtn, startScore === s ? styles.toggleBtnOn : ''].filter(Boolean).join(' ')}
                  onClick={() => dispatch({ type: 'SET_START_SCORE', score: s })}
                >{s}</button>
              ))}
            </div>
          </div>

          <div className={styles.section}>
            <div className={styles.label}>legs</div>
            <div className={styles.toggle}>
              {([1, 3, 5] as const).map(n => (
                <button
                  key={n}
                  className={[styles.toggleBtn, legCount === n ? styles.toggleBtnOn : ''].filter(Boolean).join(' ')}
                  onClick={() => dispatch({ type: 'SET_LEG_COUNT', count: n })}
                >{n}</button>
              ))}
            </div>
          </div>

          <div className={styles.section}>
            <div className={styles.label}>players</div>
            <div className={styles.playerList}>
              {players.map(p => (
                <div key={p.id} className={styles.playerRow}>
                  <input
                    className={styles.nameInput}
                    value={p.name}
                    onChange={e => dispatch({ type: 'RENAME_PLAYER', id: p.id, name: e.target.value })}
                    autoCapitalize="none"
                    spellCheck={false}
                  />
                  <button
                    className={styles.removeBtn}
                    onClick={() => dispatch({ type: 'REMOVE_PLAYER', id: p.id })}
                    aria-label="Remove player"
                  >×</button>
                </div>
              ))}
            </div>
            {players.length < 8 && (
              <button className={styles.addPlayerBtn} onClick={() => dispatch({ type: 'ADD_PLAYER' })}>
                + add player
              </button>
            )}
          </div>

          <button
            className={styles.startBtn}
            onClick={() => dispatch({ type: 'START' })}
            disabled={players.length === 0}
          >start game</button>
        </div>
      </div>
    )
  }

  // ── Done ──────────────────────────────────────────────────────────────────
  if (phase === 'done') {
    const ranked = [...players].sort((a, b) => legWins(state, b.id) - legWins(state, a.id))
    return (
      <div className={styles.app}>
        <AppHeader title="darts" about={about} />
        <div className={styles.content}>
          <div className={styles.doneIntro}>
            <span className={styles.label}>{startScore} · {legCount} {legCount === 1 ? 'leg' : 'legs'}</span>
          </div>
          <div className={styles.leaderboard}>
            {ranked.map((p, i) => {
              const wins = legWins(state, p.id)
              return (
                <div key={p.id} className={styles.leaderRow}>
                  <span className={styles.rank}>{i + 1}</span>
                  <span className={styles.leaderName}>{p.name}</span>
                  <span className={styles.leaderLegs}>{wins}</span>
                  <span className={styles.leaderLegLabel}>{wins === 1 ? 'leg' : 'legs'}</span>
                </div>
              )
            })}
          </div>
          <div className={styles.doneActions}>
            <button className={styles.newGameBtn} onClick={() => dispatch({ type: 'NEW_GAME' })}>new game</button>
          </div>
        </div>
      </div>
    )
  }

  // ── Play ──────────────────────────────────────────────────────────────────
  // Build row data: one row per "round" (all players have thrown once)
  const maxTurns = players.length > 0
    ? Math.max(...players.map(p => (currentLegData?.scores[p.id] ?? []).length))
    : 0
  // Show one pending row if no leg winner yet
  const rowCount = legWon ? maxTurns : maxTurns + 1

  const inner = (
    <div className={styles.content}>
      <div className={styles.scoresheetWrap}>
        <table className={styles.scoresheet}>
          <thead>
            <tr>
              {players.map((p, pi) => (
                <Fragment key={p.id}>
                  {pi > 0 && <th className={styles.dividerCol} />}
                  <th colSpan={2} className={styles.playerHeadCell}>
                    <span className={[styles.playerHeadName, pi === activePlayer && !legWon ? styles.activePlayer : ''].filter(Boolean).join(' ')}>
                      {p.name}
                    </span>
                    <div className={styles.legDots}>
                      {Array.from({ length: legWins(state, p.id) }).map((_, i) => (
                        <span key={i} className={styles.legDot}>●</span>
                      ))}
                    </div>
                  </th>
                </Fragment>
              ))}
            </tr>
            <tr>
              {players.map((p, pi) => (
                <Fragment key={p.id}>
                  {pi > 0 && <th className={styles.dividerCol} />}
                  <th className={styles.subHeadCell}>scored</th>
                  <th className={styles.subHeadCell}>rem</th>
                </Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rowCount }, (_, row) => (
              <tr key={row}>
                {players.map((p, pi) => {
                  const turns = currentLegData?.scores[p.id] ?? []
                  const turn = turns[row]
                  const remAfter = state.startScore - turns.slice(0, row + 1).filter(t => !t.bust).reduce((s, t) => s + t.score, 0)
                  const isActivePending = row === turns.length && pi === activePlayer && !legWon
                  const isWinTurn = turn && !turn.bust && remAfter === 0

                  return (
                    <Fragment key={p.id}>
                      {pi > 0 && <td className={styles.dividerCol} />}
                      <td
                        className={[styles.throwCell, pi === activePlayer && !legWon ? styles.activeCol : '', turn ? styles.editableCell : ''].filter(Boolean).join(' ')}
                        onClick={turn ? () => { setEditCell({ playerId: p.id, turnIndex: row }); setPickerOpen(true) } : undefined}
                      >
                        {turn
                          ? turn.bust
                            ? <span className={styles.bustText}>bust</span>
                            : <span className={isWinTurn ? styles.winCell : ''}>{turn.score}</span>
                          : isActivePending
                            ? <span className={styles.pendingCell}>—</span>
                            : null
                        }
                      </td>
                      <td className={[styles.remCell, pi === activePlayer && !legWon ? styles.activeCol : ''].filter(Boolean).join(' ')}>
                        {turn
                          ? isWinTurn
                            ? <span className={styles.winCell}>0<span className={styles.winMark}>✓</span></span>
                            : <span className={remAfter <= 60 ? styles.remLow : remAfter <= 180 ? styles.remMid : styles.remHigh}>{remAfter}</span>
                          : isActivePending
                            ? <span className={remaining(state, p.id) <= 60 ? styles.remLow : remaining(state, p.id) <= 180 ? styles.remMid : styles.remHigh}>
                                {remaining(state, p.id)}
                              </span>
                            : null
                        }
                      </td>
                    </Fragment>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!legWon && (
        <button
          className={styles.startBtn}
          onClick={() => setPickerOpen(true)}
        >
          enter score — {currentPlayer?.name}
        </button>
      )}

      <button className={styles.quitBtn} onClick={() => dispatch({ type: 'NEW_GAME' })}>
        quit
      </button>

      {pickerOpen && pickerPlayer && (
        <>
          <div className={styles.pickerBackdrop} onClick={() => setPickerOpen(false)} />
          <div className={styles.picker}>
            <div className={styles.pickerInfo}>
              <span>{pickerPlayer.name}</span>
              <span className={styles.pickerDot}>·</span>
              <span>leg {currentLeg + 1}</span>
              <span className={styles.pickerRemaining}>{pickerRemaining}</span>
            </div>
            <div className={styles.pickerGrid}>
              {QUICK_SCORES.map(s => {
                const wouldBust = s > pickerRemaining || pickerRemaining - s === 1
                return (
                  <button
                    key={s}
                    className={[styles.pickBtn, wouldBust ? styles.pickBtnDim : ''].filter(Boolean).join(' ')}
                    onClick={() => submitScore(wouldBust ? 0 : s, wouldBust)}
                  >{s}</button>
                )
              })}
            </div>
            <div className={styles.pickerBottom}>
              <div />
              <div className={styles.pickerBottomCenter}>
                <input
                  type="number"
                  className={styles.customInput}
                  value={customVal}
                  min={0}
                  max={180}
                  onChange={e => setCustomVal(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleCustomOk()
                  }}
                  placeholder="0–180"
                />
                <button className={[styles.pickerBtn, styles.pickerBtnFill].join(' ')} onClick={handleCustomOk}>✓</button>
              </div>
              <div className={styles.pickerBottomRight}>
                <button
                  className={styles.pickerBtn}
                  onClick={() => submitScore(0, true)}
                >bust</button>
              </div>
            </div>
          </div>
        </>
      )}

      {legWon && currentLegData && (
        <div className={styles.legBannerBackdrop}>
          <div className={styles.legBanner}>
            <div className={styles.legBannerName}>
              {players.find(p => p.id === currentLegData.winner)?.name}
            </div>
            <div className={styles.legBannerSub}>wins leg {currentLeg + 1}</div>
            <div className={styles.legBannerActions}>
              <button className={styles.legBannerBtn} onClick={() => dispatch({ type: 'NEXT_LEG' })}>
                {(() => {
                  const nextIdx = currentLeg + 1
                  const maxWins = Math.ceil(legCount / 2)
                  const matchWinner = players.find(p => legWins(state, p.id) >= maxWins)
                  return matchWinner || nextIdx >= legCount ? 'finish' : `leg ${nextIdx + 1}`
                })()}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )

  if (isLandscapeMobile) {
    return <div className={styles.focusOverlay}>{inner}</div>
  }

  return (
    <div className={styles.app}>
      <AppHeader title="darts" about={about} />
      {inner}
    </div>
  )
}
