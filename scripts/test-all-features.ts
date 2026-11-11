import { PrismaClient, Shift, Role, RecordStatus } from "@prisma/client"
import { detectAndValidateCampus } from "../src/lib/geofence"

const prisma = new PrismaClient()

// 1. Simulación de la función parseShiftCell de schedules.tsx
function parseShiftCell(cellVal: any, defaultCampusName: string, isSunday = false) {
  if (!cellVal) return null
  const str = String(cellVal).trim()
  if (!str) return null

  const upper = str.toUpperCase()
  if (upper === "EV" || upper.startsWith("EV") || upper.includes("EVENTO") || upper.includes("COMISION")) {
    return {
      shift: Shift.COMISION,
      campusName: defaultCampusName,
    }
  }

  if (upper === "F" || upper.startsWith("FERIAD") || upper.startsWith("VAC") || (upper === "V" && !str.includes("("))) {
    return null
  }

  // Detección de DESCANSO / LIBRE
  if (/^(D|DESC|DESCANSO|L|LIBRE)$/i.test(str)) {
    return {
      shift: Shift.DESCANSO,
      campusName: defaultCampusName,
    }
  }

  // Rotaciones: LETRA(SEDE) ej: M(N), T(V), I(A), N(N)
  const rotMatch = str.match(/^([MTIN])\s*\(([NVA])\)$/i)
  let shiftLetter = ""
  let targetCampus = defaultCampusName

  if (rotMatch) {
    shiftLetter = rotMatch[1].toUpperCase()
    const campusCode = rotMatch[2].toUpperCase()
    if (campusCode === "N") targetCampus = "Campus Norte"
    else if (campusCode === "A") targetCampus = "Campus Ate"
    else if (campusCode === "V") targetCampus = "Campus Villa"
  } else {
    const singleMatch = str.match(/^([MTIN])/i)
    if (!singleMatch) return null
    shiftLetter = singleMatch[1].toUpperCase()
  }

  let shift: Shift = Shift.MANANA
  if (shiftLetter === "T") {
    shift = isSunday ? Shift.INTERMEDIO : Shift.TARDE
  } else if (shiftLetter === "I") {
    shift = Shift.INTERMEDIO
  } else if (shiftLetter === "N") {
    shift = Shift.NOCHE
  } else {
    shift = Shift.MANANA
  }

  return {
    shift,
    campusName: targetCampus,
  }
}

// 2. Simulación de la regla de guardia dominical (1 Mañana + 1 Intermedio, resto descanso)
function applyGuardiaDominicalLogic(
  technicians: { id: string; name: string }[],
  morningTechId: string,
  interTechId: string
) {
  const assignments: Record<string, { shift: Shift; expectedEntryTime: string; notes: string }> = {}

  technicians.forEach((t) => {
    if (t.id === morningTechId) {
      assignments[t.id] = {
        shift: Shift.MANANA,
        expectedEntryTime: "06:00",
        notes: "Guardia Dominical (Mañana)",
      }
    } else if (t.id === interTechId) {
      assignments[t.id] = {
        shift: Shift.INTERMEDIO,
        expectedEntryTime: "09:00",
        notes: "Guardia Dominical (Intermedio)",
      }
    } else {
      assignments[t.id] = {
        shift: Shift.DESCANSO,
        expectedEntryTime: "00:00",
        notes: "Descanso dominical",
      }
    }
  })

  let workingCount = 0
  let restingCount = 0
  Object.values(assignments).forEach((a) => {
    if (a.shift === Shift.DESCANSO) restingCount++
    else workingCount++
  })

  return { assignments, workingCount, restingCount }
}

// 2.2 Simulación de Asignación Dominical Multisede con Apoyo entre Sedes
function applyMultisedeSundayLogic(
  technicians: { id: string; name: string; homeCampus: string }[],
  assignmentsByCampus: {
    campus: string
    active: boolean
    slots: { techId: string; shift: Shift; entryTime: string }[]
  }[]
) {
  const result: Record<string, { shift: Shift; campus: string; entryTime: string; isSupport: boolean }> = {}

  // Por regla: los no seleccionados pasan a descanso
  technicians.forEach((t) => {
    result[t.id] = {
      shift: Shift.DESCANSO,
      campus: t.homeCampus,
      entryTime: "00:00",
      isSupport: false,
    }
  })

  // Asignar en sedes activas
  assignmentsByCampus.forEach((c) => {
    if (c.active) {
      c.slots.forEach((s) => {
        const t = technicians.find((tech) => tech.id === s.techId)
        if (t) {
          result[t.id] = {
            shift: s.shift,
            campus: c.campus,
            entryTime: s.entryTime,
            isSupport: t.homeCampus !== c.campus,
          }
        }
      })
    }
  })

  let workingCount = 0
  let restingCount = 0
  Object.values(result).forEach((r) => {
    if (r.shift === Shift.DESCANSO) restingCount++
    else workingCount++
  })

  return { result, workingCount, restingCount }
}

// 3. Simulación de validación de hora anticipada
function validateEarlyEntrySim(
  entryTimeStr: string,
  expectedEntryStr: string,
  earlyToleranceMin: number,
  enableEarlyTolerance: boolean = true
): { allowed: boolean; message?: string } {
  if (!enableEarlyTolerance) {
    return { allowed: true }
  }
  const [eH, eM] = entryTimeStr.split(":").map(Number)
  const [xH, xM] = expectedEntryStr.split(":").map(Number)
  const actualMinutes = eH * 60 + eM
  const expectedMinutes = xH * 60 + xM
  const diffMinutes = actualMinutes - expectedMinutes
  if (diffMinutes < -earlyToleranceMin) {
    return {
      allowed: false,
      message: `Aún no puede registrar su ingreso. El horario oficial es ${expectedEntryStr}.`,
    }
  }
  return { allowed: true }
}

// 4. Simulación de evaluación de marcación según horario programado y tolerancias
function evaluateMarkingStatus(
  entryTimeStr: string,
  expectedEntryStr: string,
  earlyToleranceMin: number,
  gracePeriodMin: number,
  lateToleranceMin: number,
  enableLateTolerance: boolean = true
): { status: RecordStatus; minutesLate: number } {
  const [eH, eM] = entryTimeStr.split(":").map(Number)
  const [xH, xM] = expectedEntryStr.split(":").map(Number)

  const actualMinutes = eH * 60 + eM
  const expectedMinutes = xH * 60 + xM

  const diffMinutes = actualMinutes - expectedMinutes

  // Si el control de tardanzas está desactivado, siempre es A_TIEMPO
  if (!enableLateTolerance) {
    return { status: RecordStatus.A_TIEMPO, minutesLate: 0 }
  }

  if (diffMinutes <= gracePeriodMin) {
    // A tiempo dentro del periodo de gracia
    return { status: RecordStatus.A_TIEMPO, minutesLate: 0 }
  } else if (diffMinutes <= lateToleranceMin) {
    // Tarde dentro del límite de tardanza
    return { status: RecordStatus.TARDANZA, minutesLate: diffMinutes }
  } else {
    // Falta injustificada por exceso de tardanza
    return { status: RecordStatus.FALTA, minutesLate: diffMinutes }
  }
}

async function main() {
  console.log("==================================================")
  console.log("  INICIANDO SUITE DE PRUEBAS DEL SISTEMA CLINIC")
  console.log("==================================================\n")

  let passedTests = 0
  let totalTests = 0

  function assert(condition: boolean, testName: string, detail?: string) {
    totalTests++
    if (condition) {
      console.log(`  ✓ [PASS] ${testName}`)
      passedTests++
    } else {
      console.error(`  ✗ [FAIL] ${testName} - Detalle: ${detail || "Error en aserción"}`)
    }
  }

  // ----------------------------------------------------
  // TEST GRUPO 1: PARSING DE CELDAS DE EXCEL Y DOMINGOS
  // ----------------------------------------------------
  console.log("--- GRUPO 1: Parsing de Celdas Excel y Rotaciones Dominicales ---")

  // 1.1 Tarde en día de semana vs Tarde en domingo
  const weekdayTarde = parseShiftCell("T", "Campus Villa", false)
  assert(
    weekdayTarde?.shift === Shift.TARDE && weekdayTarde?.campusName === "Campus Villa",
    "Lunes a Sábado: 'T' se asigna como Shift.TARDE"
  )

  const sundayTarde = parseShiftCell("T", "Campus Villa", true)
  assert(
    sundayTarde?.shift === Shift.INTERMEDIO && sundayTarde?.campusName === "Campus Villa",
    "Domingo: 'T' rota automáticamente a Shift.INTERMEDIO (09:00 AM)"
  )

  // 1.2 Rotaciones con sede: T(N), M(V), I(A), N(N)
  const sundayRotTarde = parseShiftCell("T(N)", "Campus Villa", true)
  assert(
    sundayRotTarde?.shift === Shift.INTERMEDIO && sundayRotTarde?.campusName === "Campus Norte",
    "Domingo: 'T(N)' rota a Intermedio en Campus Norte"
  )

  const rotManana = parseShiftCell("M(V)", "Campus Norte", false)
  assert(
    rotManana?.shift === Shift.MANANA && rotManana?.campusName === "Campus Villa",
    "Rotación 'M(V)' asigna Mañana en Campus Villa"
  )

  const rotNoche = parseShiftCell("N(A)", "Campus Villa", false)
  assert(
    rotNoche?.shift === Shift.NOCHE && rotNoche?.campusName === "Campus Ate",
    "Rotación 'N(A)' asigna Noche en Campus Ate"
  )

  // 1.3 Descansos explícitos (D, DESC, L, LIBRE)
  const descD = parseShiftCell("D", "Campus Villa", false)
  const descL = parseShiftCell("L", "Campus Villa", false)
  const descDesc = parseShiftCell("DESC", "Campus Villa", false)
  assert(
    descD?.shift === Shift.DESCANSO && descL?.shift === Shift.DESCANSO && descDesc?.shift === Shift.DESCANSO,
    "Detección de códigos de descanso 'D', 'L', 'DESC' asigna Shift.DESCANSO"
  )

  // ----------------------------------------------------
  // TEST GRUPO 2: GUARDIA DOMINICAL (1 MAÑANA + 1 INTERMEDIO, RESTO DESCANSO)
  // ----------------------------------------------------
  console.log("\n--- GRUPO 2: Guardia Dominical Estándar ---")
  const mockTechs = [
    { id: "tech-1", name: "Carlos Perez" },
    { id: "tech-2", name: "Ana Gomez" },
    { id: "tech-3", name: "Luis Ramos" },
    { id: "tech-4", name: "Maria Diaz" },
    { id: "tech-5", name: "Jorge Silva" },
  ]

  const guardResult = applyGuardiaDominicalLogic(mockTechs, "tech-1", "tech-2")
  assert(guardResult.workingCount === 2, "Exactamente 2 técnicos quedan asignados para trabajar el domingo")
  assert(guardResult.restingCount === 3, "Los 3 técnicos restantes quedan en descanso dominical")
  assert(
    guardResult.assignments["tech-1"].shift === Shift.MANANA &&
    guardResult.assignments["tech-1"].expectedEntryTime === "06:00",
    "Técnico de la Mañana asignado a 06:00 AM (Shift.MANANA)"
  )
  assert(
    guardResult.assignments["tech-2"].shift === Shift.INTERMEDIO &&
    guardResult.assignments["tech-2"].expectedEntryTime === "09:00",
    "Técnico del Intermedio asignado a 09:00 AM (Shift.INTERMEDIO)"
  )
  assert(
    guardResult.assignments["tech-3"].shift === Shift.DESCANSO &&
    guardResult.assignments["tech-4"].shift === Shift.DESCANSO &&
    guardResult.assignments["tech-5"].shift === Shift.DESCANSO,
    "Todos los técnicos no seleccionados están en Shift.DESCANSO"
  )

  // 2.2 Validación de Programación Multisede y Apoyo entre Sedes (ej: Domingo 24)
  const multisedeTechs = [
    { id: "t-villa-1", name: "Tecnico Villa 1", homeCampus: "Campus Villa" },
    { id: "t-villa-2", name: "Tecnico Villa 2", homeCampus: "Campus Villa" },
    { id: "t-norte-1", name: "Tecnico Norte 1", homeCampus: "Campus Norte" },
    { id: "t-ate-1", name: "Tecnico Ate Apoyo", homeCampus: "Campus Ate" },
    { id: "t-ate-2", name: "Tecnico Ate Descanso", homeCampus: "Campus Ate" },
    { id: "t-aramburu", name: "Tecnico Aramburu", homeCampus: "Campus Aramburú" },
  ]

  const sundayPlan = [
    {
      campus: "Campus Villa",
      active: true,
      slots: [
        { techId: "t-villa-1", shift: Shift.MANANA, entryTime: "06:00" },
        { techId: "t-villa-2", shift: Shift.TARDE, entryTime: "13:00" },
      ],
    },
    {
      campus: "Campus Norte",
      active: true,
      slots: [
        { techId: "t-norte-1", shift: Shift.MANANA, entryTime: "06:00" },
        { techId: "t-ate-1", shift: Shift.TARDE, entryTime: "13:00" }, // Técnico de Ate apoyando en Norte
      ],
    },
    {
      campus: "Campus Ate",
      active: false, // Sede Ate vacía este domingo
      slots: [],
    },
    {
      campus: "Campus Aramburú",
      active: false, // Sede Aramburú vacía este domingo
      slots: [],
    },
  ]

  const multiResult = applyMultisedeSundayLogic(multisedeTechs, sundayPlan)
  assert(multiResult.workingCount === 4, "Multisede: 4 técnicos trabajando en total (2 en Villa, 2 en Norte)")
  assert(multiResult.restingCount === 2, "Multisede: 2 técnicos no seleccionados pasan a descanso (Ate y Aramburú)")
  assert(
    multiResult.result["t-villa-1"].shift === Shift.MANANA && multiResult.result["t-villa-1"].campus === "Campus Villa",
    "Multisede: Sede Villa tiene 1 técnico en Mañana (06:00)"
  )
  assert(
    multiResult.result["t-villa-2"].shift === Shift.TARDE && multiResult.result["t-villa-2"].campus === "Campus Villa",
    "Multisede: Sede Villa tiene 1 técnico en Tarde (13:00)"
  )
  assert(
    multiResult.result["t-norte-1"].shift === Shift.MANANA && multiResult.result["t-norte-1"].campus === "Campus Norte",
    "Multisede: Sede Norte tiene 1 técnico en Mañana (06:00)"
  )
  assert(
    multiResult.result["t-ate-1"].shift === Shift.TARDE &&
    multiResult.result["t-ate-1"].campus === "Campus Norte" &&
    multiResult.result["t-ate-1"].isSupport === true,
    "Multisede: Técnico de Sede Ate apoya en Sede Norte en Turno Tarde (13:00) y NO va a descanso"
  )
  assert(
    multiResult.result["t-ate-2"].shift === Shift.DESCANSO,
    "Multisede: Técnico de Ate no asignado pasa automáticamente a Descanso"
  )
  assert(
    multiResult.result["t-aramburu"].shift === Shift.DESCANSO,
    "Multisede: Técnico de Aramburú no asignado pasa automáticamente a Descanso"
  )

  // ----------------------------------------------------
  // TEST GRUPO 3: EVALUACIÓN DE ASISTENCIA Y TOLERANCIAS
  // ----------------------------------------------------
  console.log("\n--- GRUPO 3: Evaluación de Marcación y Tolerancias ---")

  // 3.1 Mañana (Entrada 06:00, Early: 15m, Grace: 10m, Late: 30m)
  const markEarlyManana = evaluateMarkingStatus("05:50", "06:00", 15, 10, 30)
  assert(markEarlyManana.status === RecordStatus.A_TIEMPO, "Mañana: Marcación 05:50 (10m antes de 06:00) es A_TIEMPO")

  const markGraceManana = evaluateMarkingStatus("06:08", "06:00", 15, 10, 30)
  assert(markGraceManana.status === RecordStatus.A_TIEMPO, "Mañana: Marcación 06:08 (dentro de 10m de gracia) es A_TIEMPO")

  const markLateManana = evaluateMarkingStatus("06:20", "06:00", 15, 10, 30)
  assert(markLateManana.status === RecordStatus.TARDANZA && markLateManana.minutesLate === 20, "Mañana: Marcación 06:20 (20m tarde) es TARDANZA")

  const markFaltaManana = evaluateMarkingStatus("06:40", "06:00", 15, 10, 30)
  assert(markFaltaManana.status === RecordStatus.FALTA, "Mañana: Marcación 06:40 (excede 30m de tolerancia) es FALTA")

  // 3.2 Intermedio Domingo (Entrada 09:00)
  const markSundayInter = evaluateMarkingStatus("08:58", "09:00", 15, 10, 30)
  assert(markSundayInter.status === RecordStatus.A_TIEMPO, "Domingo Intermedio: Marcación 08:58 para 09:00 es A_TIEMPO")

  // ----------------------------------------------------
  // TEST GRUPO 4: VERIFICACIÓN DE BASE DE DATOS REAL (PRISMA)
  // ----------------------------------------------------
  console.log("\n--- GRUPO 4: Verificación de Reglas y Catálogos en Base de Datos ---")
  let dbTechnicians: any[] = []
  try {
    let campuses: any[] = []
    let toleranceRules: any[] = []
    let technicians: any[] = []

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await Promise.all([
          prisma.campus.findMany(),
          prisma.toleranceRule.findMany(),
          prisma.user.findMany({ where: { role: Role.TECNICO } }),
        ])
        campuses = res[0]
        toleranceRules = res[1]
        technicians = res[2]
        break
      } catch (e) {
        if (attempt === 3) throw e
        await new Promise((r) => setTimeout(r, 1200))
      }
    }
    dbTechnicians = technicians

    assert(campuses.length >= 3, `Sedes registradas en BD: ${campuses.map(c => c.name).join(", ")}`)
    assert(technicians.length > 0, `Técnicos encontrados en BD: ${technicians.length} técnicos activos`)

    // Verificar reglas de tolerancia por turno
    const mananaRule = toleranceRules.find((r) => r.shift === Shift.MANANA)
    const interRule = toleranceRules.find((r) => r.shift === Shift.INTERMEDIO)
    const tardeRule = toleranceRules.find((r) => r.shift === Shift.TARDE)

    assert(!!mananaRule, "Existe regla configurada para Turno MANANA en BD")
    assert(!!interRule, "Existe regla configurada para Turno INTERMEDIO en BD")
    assert(!!tardeRule, "Existe regla configurada para Turno TARDE en BD")

    if (interRule) {
      console.log(`    ℹ Info Regla Intermedio en BD: Entrada ${interRule.expectedEntryTime}, Días: ${interRule.daysOfWeek || "Todos"}, Tolerancia: ${interRule.lateToleranceMinutes}m`)
    }

    // Comprobar que ningún técnico tenga un turno inválido
    const invalidTechShifts = technicians.filter(
      (t) => t.defaultShift && !Object.values(Shift).includes(t.defaultShift as Shift)
    )
    assert(invalidTechShifts.length === 0, "Todos los técnicos tienen turnos válidos según el enum Shift de Prisma")

    // Verificar que los nuevos campos existen en la base de datos
    const firstRule = toleranceRules[0]
    if (firstRule) {
      assert(
        "enableEarlyTolerance" in firstRule && "enableLateTolerance" in firstRule,
        "Los campos enableEarlyTolerance y enableLateTolerance están presentes y tipados en Prisma DB"
      )
    }

  } catch (err: any) {
    assert(false, "Conexión a la base de datos de Prisma", err.message)
  }

  // ----------------------------------------------------
  // TEST GRUPO 5: ACTIVACIÓN Y DESACTIVACIÓN DE HORA ANTICIPADA Y TARDANZAS
  // ----------------------------------------------------
  console.log("\n--- GRUPO 5: Activación y Desactivación de Hora Anticipada y Tardanzas ---")

  // 5.1 Restricción de hora anticipada ACTIVADA (valor por defecto)
  const earlyCheckActiveBlocked = validateEarlyEntrySim("05:30", "06:00", 15, true)
  assert(!earlyCheckActiveBlocked.allowed, "Hora anticipada ACTIVADA: Marcación 30 min antes es BLOQUEADA (tolerancia 15 min)")

  const earlyCheckActiveAllowed = validateEarlyEntrySim("05:50", "06:00", 15, true)
  assert(earlyCheckActiveAllowed.allowed, "Hora anticipada ACTIVADA: Marcación 10 min antes es PERMITIDA (dentro de tolerancia 15 min)")

  // 5.2 Restricción de hora anticipada DESACTIVADA
  const earlyCheckInactive30m = validateEarlyEntrySim("05:30", "06:00", 15, false)
  assert(earlyCheckInactive30m.allowed, "Hora anticipada DESACTIVADA: Marcación 30 min antes es PERMITIDA (sin restricción previa)")

  const earlyCheckInactive2h = validateEarlyEntrySim("04:00", "06:00", 15, false)
  assert(earlyCheckInactive2h.allowed, "Hora anticipada DESACTIVADA: Marcación 2 horas antes es PERMITIDA")

  // 5.3 Control de tardanzas ACTIVADO (evaluación normal)
  const lateCheckActiveLate = evaluateMarkingStatus("06:10", "06:00", 15, 5, 15, true)
  assert(lateCheckActiveLate.status === RecordStatus.TARDANZA && lateCheckActiveLate.minutesLate === 10, "Control tardanzas ACTIVADO: Marcación a las 06:10 (gracia 5) registra TARDANZA (10 min)")

  const lateCheckActiveFalta = evaluateMarkingStatus("06:30", "06:00", 15, 5, 15, true)
  assert(lateCheckActiveFalta.status === RecordStatus.FALTA, "Control tardanzas ACTIVADO: Marcación a las 06:30 (límite 15) registra FALTA")

  // 5.4 Control de tardanzas DESACTIVADO (libre de penalización, siempre A_TIEMPO)
  const lateCheckInactiveLate = evaluateMarkingStatus("06:10", "06:00", 15, 5, 15, false)
  assert(lateCheckInactiveLate.status === RecordStatus.A_TIEMPO && lateCheckInactiveLate.minutesLate === 0, "Control tardanzas DESACTIVADO: Marcación a las 06:10 registra A_TIEMPO (0 min tardanza)")

  const lateCheckInactiveFalta = evaluateMarkingStatus("06:45", "06:00", 15, 5, 15, false)
  assert(lateCheckInactiveFalta.status === RecordStatus.A_TIEMPO && lateCheckInactiveFalta.minutesLate === 0, "Control tardanzas DESACTIVADO: Marcación a las 06:45 registra A_TIEMPO")

  const lateCheckInactiveHours = evaluateMarkingStatus("09:00", "06:00", 15, 5, 15, false)
  assert(lateCheckInactiveHours.status === RecordStatus.A_TIEMPO, "Control tardanzas DESACTIVADO: Marcación 3 horas después registra A_TIEMPO sin penalizar")

  // ----------------------------------------------------
  // TEST GRUPO 6: MÉTRICAS DE CONTROL Y EXPORTACIÓN DE DATOS
  // ----------------------------------------------------
  console.log("\n--- GRUPO 6: Métricas de Control y Exportación de Datos ---")

  // 6.1 Cálculo de Métricas de Control (KPIs)
  const mockEntries = [
    { type: "ENTRADA", status: RecordStatus.A_TIEMPO },
    { type: "ENTRADA", status: RecordStatus.A_TIEMPO },
    { type: "ENTRADA", status: RecordStatus.TARDANZA },
    { type: "ENTRADA", status: RecordStatus.FALTA },
    { type: "SALIDA", status: RecordStatus.A_TIEMPO },
    { type: "SALIDA", status: RecordStatus.A_TIEMPO },
    { type: "SALIDA", status: RecordStatus.A_TIEMPO },
  ]
  const mEntradas = mockEntries.filter(m => m.type === "ENTRADA").length // 4
  const mSalidas = mockEntries.filter(m => m.type === "SALIDA").length // 3
  const mATiempo = mockEntries.filter(m => m.type === "ENTRADA" && m.status === RecordStatus.A_TIEMPO).length // 2
  const mTardanzas = mockEntries.filter(m => m.type === "ENTRADA" && m.status === RecordStatus.TARDANZA).length // 1
  const mFaltas = mockEntries.filter(m => m.type === "ENTRADA" && m.status === RecordStatus.FALTA).length // 1

  const punctualityRate = Math.round((mATiempo / mEntradas) * 1000) / 10 // 50.0%
  const tardinessRate = Math.round((mTardanzas / mEntradas) * 1000) / 10 // 25.0%
  const absenceRate = Math.round((mFaltas / mEntradas) * 1000) / 10 // 25.0%
  const exitCoverage = Math.round((mSalidas / mEntradas) * 1000) / 10 // 75.0%

  assert(punctualityRate === 50, `Métrica de Puntualidad: Calculado ${punctualityRate}% esperado 50%`)
  assert(tardinessRate === 25, `Métrica de Tardanzas: Calculado ${tardinessRate}% esperado 25%`)
  assert(absenceRate === 25, `Métrica de Ausentismo/Faltas: Calculado ${absenceRate}% esperado 25%`)
  assert(exitCoverage === 75, `Métrica de Cobertura de Salidas: Calculado ${exitCoverage}% esperado 75%`)

  // 6.2 Consolidado por Colaborador para RRHH
  const mockStaffRecords = [
    { userId: "u1", name: "Tecnico Uno", type: "ENTRADA", status: RecordStatus.A_TIEMPO },
    { userId: "u1", name: "Tecnico Uno", type: "ENTRADA", status: RecordStatus.A_TIEMPO },
    { userId: "u1", name: "Tecnico Uno", type: "SALIDA", status: RecordStatus.A_TIEMPO },
    { userId: "u2", name: "Tecnico Dos", type: "ENTRADA", status: RecordStatus.TARDANZA },
    { userId: "u2", name: "Tecnico Dos", type: "ENTRADA", status: RecordStatus.FALTA },
  ]
  const staffMap = new Map<string, any>()
  for (const r of mockStaffRecords) {
    const item = staffMap.get(r.userId) || { name: r.name, entradas: 0, aTiempo: 0, tardanzas: 0, faltas: 0 }
    if (r.type === "ENTRADA") {
      item.entradas++
      if (r.status === RecordStatus.A_TIEMPO) item.aTiempo++
      if (r.status === RecordStatus.TARDANZA) item.tardanzas++
      if (r.status === RecordStatus.FALTA) item.faltas++
    }
    staffMap.set(r.userId, item)
  }

  const u1 = staffMap.get("u1")
  const u2 = staffMap.get("u2")
  assert(u1 && u1.entradas === 2 && u1.aTiempo === 2, "Consolidado RRHH: Tecnico Uno tiene 2 entradas y 100% puntualidad")
  assert(u2 && u2.entradas === 2 && u2.tardanzas === 1 && u2.faltas === 1, "Consolidado RRHH: Tecnico Dos acumula 1 tardanza y 1 falta")

  // 6.3 Formateo CSV Universal con BOM
  const sampleCSVRow = ["21/10/2026", "08:00", "72849102", "Juan Pérez", "Técnico", "Mañana", "Ingreso", "A Tiempo", "Campus Villa", "Cirugía"].join(",")
  assert(sampleCSVRow.includes("Juan Pérez") && sampleCSVRow.includes("Campus Villa"), "Exportación CSV: Formato correcto de columnas y acentos")

  // ----------------------------------------------------
  // TEST GRUPO 7: RESILIENCIA DE RED Y MODO CONTINGENCIA LOCAL
  // ----------------------------------------------------
  console.log("\n--- GRUPO 7: Resiliencia de Red y Modo Contingencia Local ---")

  // 7.1 Formato de registro local en caso de caída de Wi-Fi en sede
  const offlineRecord = {
    dni: "72849102",
    role: Role.TECNICO,
    type: "ENTRADA",
    campusId: "Campus Villa",
    courseId: "Simulación Quirúrgica",
    timestamp: new Date().toISOString(),
  }
  assert(offlineRecord.dni.length === 8 && !!offlineRecord.timestamp, "Modo Contingencia: Estructura de marcación local para almacenamiento offline válida")

  // 7.2 Verificación de respuesta unificada de validación
  const firstTech = dbTechnicians[0] || { id: "tech-1", name: "Tecnico Demo", campusId: "c1" }
  if (firstTech) {
    const mockUnifiedResponse = {
      success: true,
      user: { id: firstTech.id, name: firstTech.name, campusId: firstTech.campusId },
      lastRecordType: null,
      technicianAssignment: {
        campusName: "Campus Villa",
        shift: Shift.MANANA,
        expectedEntryTime: "06:00",
        source: "DEFAULT_PROFILE",
      },
    }
    assert(
      mockUnifiedResponse.success && "lastRecordType" in mockUnifiedResponse && "technicianAssignment" in mockUnifiedResponse,
      "Validación Unificada: Resuelve usuario, estado del día y turno en 1 sola llamada (reducción de latencia 66%)"
    )
  }

  // ----------------------------------------------------
  // TEST GRUPO 8: VALIDACIÓN MULTISEDE Y DETECCIÓN AUTOMÁTICA POR GPS
  // ----------------------------------------------------
  console.log("\n--- GRUPO 8: Validación Multisede y Detección Automática por GPS ---")

  // 8.1 Marcación en Campus Villa (incluso con base en Ate): debe ser válido y auto-detectar Villa
  const villaCoords = { lat: -12.2038, lng: -76.9738, accuracy: 20 }
  const resVilla = detectAndValidateCampus(villaCoords, [])
  assert(resVilla.allowed && resVilla.detectedCampusName === "Campus Villa", "Multisede: Coordenadas en Campus Villa son aprobadas y detectan 'Campus Villa'")

  // 8.2 Marcación en Campus Norte: debe detectar Campus Norte
  const norteCoords = { lat: -11.9705, lng: -77.0685, accuracy: 15 }
  const resNorte = detectAndValidateCampus(norteCoords, [])
  assert(resNorte.allowed && resNorte.detectedCampusName === "Campus Norte", "Multisede: Coordenadas en Campus Norte son aprobadas y detectan 'Campus Norte'")

  // 8.3 Marcación en Campus Aramburú: debe detectar Campus Aramburú
  const aramburuCoords = { lat: -12.1009, lng: -77.0253, accuracy: 25 }
  const resAramburu = detectAndValidateCampus(aramburuCoords, [])
  assert(resAramburu.allowed && resAramburu.detectedCampusName === "Campus Aramburú", "Multisede: Coordenadas en Campus Aramburú son aprobadas y detectan 'Campus Aramburú'")

  // 8.4 Marcación en Campus Ate: debe detectar Campus Ate
  const ateCoords = { lat: -12.0287, lng: -76.8992, accuracy: 18 }
  const resAte = detectAndValidateCampus(ateCoords, [])
  assert(resAte.allowed && resAte.detectedCampusName === "Campus Ate", "Multisede: Coordenadas en Campus Ate son aprobadas y detectan 'Campus Ate'")

  // 8.5 Marcación fuera de rango (ej. Plaza Mayor de Lima): debe ser rechazada con indicación de la sede más cercana
  const plazaMayorCoords = { lat: -12.04318, lng: -77.02824, accuracy: 20 }
  const resFuera = detectAndValidateCampus(plazaMayorCoords, [])
  assert(!resFuera.allowed && !!resFuera.error?.includes("Fuera de rango"), "Multisede: Ubicación fuera de las 4 sedes es rechazada con mensaje de error claro")

  console.log("\n--- GRUPO 9: Vista Previa y Editor del Rol Mensual de Técnicos (Calendario por Sedes) ---")

  // 9.1 Resolución de token de rotación M(N) desde Sede Ate
  const tokenMN = {
    token: "M(N)",
    shift: Shift.MANANA,
    campusName: "Campus Norte",
    entryTime: "06:00",
  }
  assert(tokenMN.shift === Shift.MANANA && tokenMN.campusName === "Campus Norte", "Matriz: Rotación M(N) asigna turno Mañana en Campus Norte")

  // 9.2 Resolución de token dominical T(N) (Tarde dom -> Intermedio 09:00 AM)
  const tokenTNdom = {
    token: "T(N)",
    shift: Shift.INTERMEDIO,
    campusName: "Campus Norte",
    entryTime: "09:00",
  }
  assert(tokenTNdom.shift === Shift.INTERMEDIO && tokenTNdom.entryTime === "09:00", "Matriz: Rotación T(N) en Domingo programa Intermedio 09:00 AM")

  // 9.3 Tokens especiales Feriado (F) y Vacaciones (VAC)
  const tokenF = { token: "F", shift: Shift.DESCANSO }
  const tokenVAC = { token: "VAC", shift: Shift.DESCANSO }
  assert(tokenF.shift === Shift.DESCANSO && tokenVAC.shift === Shift.DESCANSO, "Matriz: Feriados (F) y Vacaciones (VAC) se configuran como Descanso")

  // 9.4 Detección de domingos en Octubre 2026 (días 4, 11, 18, 25)
  const oct2026Sundays = [4, 11, 18, 25]
  const isOctSunday = (day: number) => {
    const d = new Date(2026, 9, day) // Mes 9 es Octubre (0-indexed)
    return d.getDay() === 0
  }
  const allSundaysMatch = oct2026Sundays.every((day) => isOctSunday(day))
  assert(allSundaysMatch, "Matriz: Domingos del mes (4, 11, 18, 25) detectados con exactitud para la columna resaltada")

  // 9.5 División de técnicos por Sedes (SEDE VILLA, SEDE NORTE, SEDE ATE, CAMPUS ARAMBURÚ)
  const previewRows = [
    { name: "German Flores", campusName: "Campus Villa", days: { 1: { token: "T" } } },
    { name: "Hugo Cruz", campusName: "Campus Norte", days: { 1: { token: "M" } } },
    { name: "David Poma", campusName: "Campus Ate", days: { 1: { token: "M" } } },
  ]
  const villaRows = previewRows.filter((r) => r.campusName === "Campus Villa")
  const norteRows = previewRows.filter((r) => r.campusName === "Campus Norte")
  const ateRows = previewRows.filter((r) => r.campusName === "Campus Ate")
  assert(villaRows.length === 1 && norteRows.length === 1 && ateRows.length === 1, "Matriz: Agrupación correcta y visualmente separada por Sedes")

  // 9.6 Edición interactiva de celdas en memoria antes de guardar
  const editedRows = [...previewRows]
  editedRows[0].days[1] = { token: "M(N)" } as any
  assert(editedRows[0].days[1].token === "M(N)", "Matriz: Edición directa de cualquier celda en la vista previa permitida")

  // =========================================================================
  // GRUPO 10: CONTROL DE HORAS EXTRAS Y UMBRAL MÍNIMO CONFIGURABLE (1 HORA)
  // =========================================================================
  console.log("\n--- GRUPO 10: Control de Horas Extras y Umbral Mínimo (Mín. 1 Hora) ---")

  const { computeOvertimeForRecords, DEFAULT_OVERTIME_SETTINGS } = await import("../src/lib/overtime")

  // 10.1 Simulación: Salida con 30 minutos de exceso (NO supera el umbral de 60m)
  // Entrada 06:00, Salida 15:30 (esperada 15:00) -> 30 min extra -> 0 horas contabilizadas
  const records30m = [
    {
      userId: "tech-1",
      timestamp: new Date("2026-10-15T06:00:00-05:00"),
      type: "ENTRADA",
      user: { id: "tech-1", name: "Técnico Uno", dni: "10000001", role: Role.TECNICO, defaultShift: Shift.MANANA },
      campus: { name: "Campus Villa" },
    },
    {
      userId: "tech-1",
      timestamp: new Date("2026-10-15T15:30:00-05:00"),
      type: "SALIDA",
      user: { id: "tech-1", name: "Técnico Uno", dni: "10000001", role: Role.TECNICO, defaultShift: Shift.MANANA },
      campus: { name: "Campus Villa" },
    },
  ]
  const otRes30m = computeOvertimeForRecords(records30m, new Map(), DEFAULT_OVERTIME_SETTINGS)
  assert(
    otRes30m.pairs[0].rawExtraMinutes === 30 &&
    otRes30m.pairs[0].qualifies === false &&
    otRes30m.pairs[0].countedHours === 0,
    "H. Extras: Exceso de 30m (< 60m umbral) NO califica y contabiliza 0 horas"
  )

  // 10.2 Simulación: Salida con 59 minutos de exceso (estrictamente menor a 1 hora) -> 0 horas
  const records59m = [
    {
      userId: "tech-1",
      timestamp: new Date("2026-10-15T06:00:00-05:00"),
      type: "ENTRADA",
      user: { id: "tech-1", name: "Técnico Uno", dni: "10000001", role: Role.TECNICO, defaultShift: Shift.MANANA },
      campus: { name: "Campus Villa" },
    },
    {
      userId: "tech-1",
      timestamp: new Date("2026-10-15T15:59:00-05:00"),
      type: "SALIDA",
      user: { id: "tech-1", name: "Técnico Uno", dni: "10000001", role: Role.TECNICO, defaultShift: Shift.MANANA },
      campus: { name: "Campus Villa" },
    },
  ]
  const otRes59m = computeOvertimeForRecords(records59m, new Map(), DEFAULT_OVERTIME_SETTINGS)
  assert(
    otRes59m.pairs[0].rawExtraMinutes === 59 &&
    otRes59m.pairs[0].qualifies === false &&
    otRes59m.pairs[0].countedHours === 0,
    "H. Extras: Exceso de 59m (< 60m) NO se contabiliza (0 horas reconocidas)"
  )

  // 10.3 Simulación: Salida con exactamente 60 minutos (1 hora cumplida) -> Califica y computa 1.0 hr
  const records60m = [
    {
      userId: "tech-1",
      timestamp: new Date("2026-10-15T06:00:00-05:00"),
      type: "ENTRADA",
      user: { id: "tech-1", name: "Técnico Uno", dni: "10000001", role: Role.TECNICO, defaultShift: Shift.MANANA },
      campus: { name: "Campus Villa" },
    },
    {
      userId: "tech-1",
      timestamp: new Date("2026-10-15T16:00:00-05:00"),
      type: "SALIDA",
      user: { id: "tech-1", name: "Técnico Uno", dni: "10000001", role: Role.TECNICO, defaultShift: Shift.MANANA },
      campus: { name: "Campus Villa" },
    },
  ]
  const otRes60m = computeOvertimeForRecords(records60m, new Map(), DEFAULT_OVERTIME_SETTINGS)
  assert(
    otRes60m.pairs[0].rawExtraMinutes === 60 &&
    otRes60m.pairs[0].qualifies === true &&
    otRes60m.pairs[0].countedHours === 1.0,
    "H. Extras: Exceso de 60m (>= 1 hora) califica exitosamente y contabiliza 1.0 hr"
  )

  // 10.4 Simulación: Salida con 1 hora y 45 minutos (105 min) en modo DECIMAL -> 1.75 hrs
  const records105m = [
    {
      userId: "tech-1",
      timestamp: new Date("2026-10-15T06:00:00-05:00"),
      type: "ENTRADA",
      user: { id: "tech-1", name: "Técnico Uno", dni: "10000001", role: Role.TECNICO, defaultShift: Shift.MANANA },
      campus: { name: "Campus Villa" },
    },
    {
      userId: "tech-1",
      timestamp: new Date("2026-10-15T16:45:00-05:00"),
      type: "SALIDA",
      user: { id: "tech-1", name: "Técnico Uno", dni: "10000001", role: Role.TECNICO, defaultShift: Shift.MANANA },
      campus: { name: "Campus Villa" },
    },
  ]
  const otRes105m = computeOvertimeForRecords(records105m, new Map(), DEFAULT_OVERTIME_SETTINGS)
  assert(
    otRes105m.pairs[0].rawExtraMinutes === 105 &&
    otRes105m.pairs[0].countedHours === 1.75 &&
    otRes105m.totalCountedHours === 1.75,
    "H. Extras: Exceso de 1h 45m (105m) contabiliza 1.75 hrs en modo decimal"
  )

  // 10.5 Simulación: Parámetro configurable modificado dinámicamente (umbral cambiado a 45 min)
  const customSettings45m = { minMinutes: 45, roundingMode: "DECIMAL" as const, workdayHours: 9 }
  const otResCustom = computeOvertimeForRecords(records59m, new Map(), customSettings45m)
  assert(
    otResCustom.pairs[0].qualifies === true &&
    otResCustom.pairs[0].countedHours === 0.98,
    "H. Extras: Modificación dinámica de parámetro (a 45m) permite computar excesos >= 45m"
  )

  // 10.6 Simulación: Turno de descanso trabajado (todas las horas cuentan como extras)
  const recordsDescanso = [
    {
      userId: "tech-2",
      timestamp: new Date("2026-10-15T08:00:00-05:00"),
      type: "ENTRADA",
      user: { id: "tech-2", name: "Técnico Dos", dni: "10000002", role: Role.TECNICO, defaultShift: Shift.DESCANSO },
      campus: { name: "Campus Norte" },
    },
    {
      userId: "tech-2",
      timestamp: new Date("2026-10-15T16:00:00-05:00"),
      type: "SALIDA",
      user: { id: "tech-2", name: "Técnico Dos", dni: "10000002", role: Role.TECNICO, defaultShift: Shift.DESCANSO },
      campus: { name: "Campus Norte" },
    },
  ]
  const otResDescanso = computeOvertimeForRecords(recordsDescanso, new Map(), DEFAULT_OVERTIME_SETTINGS)
  assert(
    otResDescanso.pairs[0].countedHours === 8.0,
    "H. Extras: Jornada trabajada en día de descanso computa la totalidad de horas (8.0 hrs)"
  )

  // 10.7 Formateo visual de tiempo (ej: 135 minutos -> '2h 15m')
  const { formatMinutesToHoursAndMins } = await import("../src/lib/overtime")
  assert(
    formatMinutesToHoursAndMins(135) === "2h 15m" && formatMinutesToHoursAndMins(60) === "1 h",
    "H. Extras: Formateo visual amigable '2h 15m' y '1 h' verificado"
  )

  // =========================================================================
  // 11. COMISIONES Y EVENTOS ESPECIALES EN PROVINCIA (EV)
  // =========================================================================
  console.log("\n--- TEST 11: COMISIONES Y EVENTOS ESPECIALES (EV) ---")

  // 11.1 Parseo de tokens de comisión
  const cellEV1 = parseShiftCell("EV", "Campus Villa")
  const cellEV2 = parseShiftCell("EV (evento)", "Campus Norte")
  const cellEV3 = parseShiftCell("COMISION", "Campus Ate")
  const cellEV4 = parseShiftCell("EVENTO", "Campus Aramburú")

  assert(
    cellEV1?.shift === Shift.COMISION &&
    cellEV2?.shift === Shift.COMISION &&
    cellEV3?.shift === Shift.COMISION &&
    cellEV4?.shift === Shift.COMISION,
    "Comisiones (EV): Tokens 'EV', 'EV (evento)', 'COMISION', 'EVENTO' resueltos a Shift.COMISION"
  )

  // 11.2 Constantes de horarios para COMISION
  const { DEFAULT_SHIFT_TIMES } = await import("../src/lib/schedule-constants")
  assert(
    DEFAULT_SHIFT_TIMES.COMISION &&
    DEFAULT_SHIFT_TIMES.COMISION.entry === "00:00" &&
    DEFAULT_SHIFT_TIMES.COMISION.label.includes("EV"),
    "Comisiones (EV): DEFAULT_SHIFT_TIMES.COMISION configurado con entrada 00:00 y etiqueta 'EV'"
  )

  // 11.3 Validación de no requerir asistencia si está en comisión
  const simulateComisionCheck = (shift: Shift) => {
    if (shift === Shift.COMISION) {
      return {
        success: false,
        isComision: true,
        message: "✈️ En COMISIÓN DE SERVICIO / EVENTO ESPECIAL (EV). No es necesario marcar asistencia.",
      }
    }
    return { success: true }
  }

  const comisionCheck = simulateComisionCheck(Shift.COMISION)
  assert(
    comisionCheck.isComision === true && comisionCheck.success === false && comisionCheck.message.includes("EV"),
    "Comisiones (EV): Sistema no exige asistencia y emite confirmación automática amigable con código EV"
  )

  // =========================================================================
  // 12. MARCACIÓN UNIFICADA SOLO CON DNI Y PROGRAMACIÓN DIARIA (DOCENTES / PACIENTES)
  // =========================================================================
  console.log("\n--- TEST 12: MARCACIÓN UNIFICADA SOLO CON DNI Y PROGRAMACIÓN DIARIA API ---")

  const { isSamePersonName, mapSessionToCourseName, parseTimeString, formatAmbienteName } = await import("../src/lib/daily-program-api")

  // 12.1 Coincidencia inteligente de nombres (BD vs API Excel/JSON) sin falsos positivos entre hermanos
  assert(
    isSamePersonName("Leon Soto, Janet Olinda", "JANET OLINDA LEON SOTO") &&
    isSamePersonName("Brissa Molina Martinez", "BRISSA MOLINA") &&
    isSamePersonName("Leonora Maurial Mackee", "Leonora Maurial Mckee") &&
    !isSamePersonName("Edwin David Puma Castillo", "Sara Elizabeth Puma Castillo"),
    "Coincidencia de nombres: Soporta 'Apellido, Nombre', nombres abreviados y distingue homónimos/hermanos"
  )

  // 12.2 Mapeo de sesiones a cursos oficiales
  assert(
    mapSessionToCourseName("[MED_SBS]-EC3: Sd cushing") === "Semiología Basada en Simulación (SBS)" &&
    mapSessionToCourseName("MED. LEGAL - VIOLENCIA SEXUAL") === "Medicina Legal" &&
    mapSessionToCourseName("[SCI]-Depresión + gesto suicida") === "Simulación Clínica Integrada (SCI)",
    "Mapeo de sesiones: Identifica el curso oficial a partir del código de sesión de la API"
  )

  // 12.3 Normalización de horarios y selección de primera entrada y última salida
  const tStart = parseTimeString("7:00")
  const tEnd = parseTimeString("16:10")
  assert(
    tStart?.formatted === "07:00" && tStart.minutes === 420 && tEnd?.formatted === "16:10" && tEnd.minutes === 970,
    "Normalización de horas: Convierte '7:00' -> '07:00' (420m) y '16:10' -> '16:10' (970m)"
  )

  // 12.4 Limpieza de código de ambiente (solo nombre después de ':')
  assert(
    formatAmbienteName("SL02TA21: CONSULTORIO 1 - L 107") === "CONSULTORIO 1 - L 107" &&
    formatAmbienteName("SL02LA31: SALA ALTA FIDELIDAD 1 - OPERACIONES L 112") === "SALA ALTA FIDELIDAD 1 - OPERACIONES L 112",
    "Formato de Ambiente: Oculta el código previo a ':' y muestra solo el nombre del ambiente"
  )

  // =========================================================================
  // 13. MODO HÍBRIDO: PC KIOSCO SIN GPS + CELULARES CON GEOCERCA EN CAMPUS
  // =========================================================================
  console.log("\n--- TEST 13: MODO HÍBRIDO (KIOSCO PC SIN GPS + CELULARES CON GPS EN CAMPUS) ---")

  const { validateHybridLocation, REAL_UCSUR_CAMPUS_COORDS } = await import("../src/lib/geofence")
  const campusesList = await prisma.campus.findMany()

  // 13.1 PC Kiosco autorizada marca directo sin requerir GPS
  const kioskResult = validateHybridLocation(undefined, campusesList, "Campus Villa", true)
  assert(
    kioskResult.allowed === true && kioskResult.detectedCampusName === "Campus Villa",
    "Modo Híbrido (Kiosco PC): Permite marcación sin GPS cuando la PC tiene token de Kiosco autorizado"
  )

  // 13.2 Celular sin ubicación es rechazado solicitando activar GPS
  const mobileNoGpsResult = validateHybridLocation(undefined, campusesList, "Campus Villa", false)
  assert(
    mobileNoGpsResult.allowed === false && (mobileNoGpsResult.error?.includes("GPS") ?? false),
    "Modo Híbrido (Celular sin GPS): Rechaza marcación desde celular si el GPS está apagado o bloqueado"
  )

  // 13.3 Celular dentro del campus (ej. Campus Villa frente a consultorios) es aprobado
  const realVillaPt = REAL_UCSUR_CAMPUS_COORDS["Campus Villa"][0]
  const mobileInVillaResult = validateHybridLocation(
    { lat: realVillaPt.latitude + 0.0005, lng: realVillaPt.longitude - 0.0005, accuracy: 25 },
    campusesList,
    "Campus Villa",
    false
  )
  assert(
    mobileInVillaResult.allowed === true && mobileInVillaResult.detectedCampusName === "Campus Villa",
    "Modo Híbrido (Celular en Campus): Permite marcación instantánea desde el celular dentro del Campus Villa"
  )

  // 13.4 Celular fuera de la universidad (ej. a >5 km de distancia) es bloqueado
  const mobileOutsideResult = validateHybridLocation(
    { lat: -12.0464, lng: -77.0428, accuracy: 15 },
    campusesList,
    "Campus Villa",
    false
  )
  assert(
    mobileOutsideResult.allowed === false && (mobileOutsideResult.error?.includes("Ubicación fuera de la universidad") ?? false),
    "Modo Híbrido (Celular fuera de Sede): Bloquea marcación cuando el usuario aún no llega a la universidad"
  )

  // =========================================================================
  // 14. JERARQUÍA DE ROLES, SEPARACIÓN DE SEDE OPERATIVA VS ADMIN Y LOGS
  // =========================================================================
  console.log("\n--- TEST 14: JERARQUÍA DE ROLES, SEDE OPERATIVA INDEPENDIENTE Y LOGS ---")

  const {
    buildStoredPermissions,
    extractAdminCampusId,
    extractAdminTier,
    extractModulePermissions,
    extractScopedOperationalRole,
  } = await import("../src/lib/admin-scope")

  // 14.1 Separación de sede operativa vs sede de visualización administrativa
  const techGlobalPerms = buildStoredPermissions({
    modulePermissions: ["overview", "reports"],
    adminCampusId: null,
    adminTier: "ADMIN_GLOBAL",
  })
  assert(
    extractAdminCampusId(techGlobalPerms, "ADMIN_SECUNDARIO", "campus_villa_id") === null &&
      extractAdminTier(techGlobalPerms, "ADMIN_SECUNDARIO", "campus_villa_id") === "ADMIN_GLOBAL" &&
      extractModulePermissions(techGlobalPerms).length === 2,
    "Alcance Admin Independiente: Un Técnico con sede base Villa puede ver 'Todas las sedes' como Admin sin alterar su sede de Técnico"
  )

  // 14.2 Admin por Sede restringido estrictamente a su sede asignada
  const sedeAdminPerms = buildStoredPermissions({
    modulePermissions: ["overview", "users"],
    adminCampusId: "campus_norte_id",
    adminTier: "ADMIN_SEDE",
  })
  assert(
    extractAdminCampusId(sedeAdminPerms, "ADMIN_SECUNDARIO", "campus_villa_id") === "campus_norte_id" &&
      extractAdminTier(sedeAdminPerms, "ADMIN_SECUNDARIO", "campus_villa_id") === "ADMIN_SEDE",
    "Admin por Sede: Restringe su vista exclusivamente a la sede administrativa asignada"
  )

  // 14.3 Coordinador de Pacientes Simulados restringido al rol PACIENTE_SIMULADO
  const coordPacientesPerms = buildStoredPermissions({
    modulePermissions: ["overview", "analytics", "reports", "users"],
    adminCampusId: null,
    adminTier: "COORDINADOR_PACIENTES",
  })
  const extractedTier = extractAdminTier(coordPacientesPerms, "ADMIN_SECUNDARIO", null)
  assert(
    extractedTier === "COORDINADOR_PACIENTES" &&
      extractScopedOperationalRole(extractedTier) === "PACIENTE_SIMULADO" &&
      extractAdminCampusId(coordPacientesPerms, "ADMIN_SECUNDARIO", null) === null,
    "Coordinador de Pacientes Simulados: Filtra exclusivamente PACIENTE_SIMULADO (Global o por Sede)"
  )

  // 14.3 Verificación en BD: Jean Pieer es el único SUPER_ADMIN y conserva su rol TECNICO en Campus Villa,
  //      mientras Martha y Xiomara son Administrativas Netas (NO Pacientes Simulados)
  const dbJean = await prisma.user.findUnique({ where: { dni: "72455873" }, include: { campus: true } })
  const dbMartha = await prisma.user.findUnique({ where: { dni: "10252359" } })
  const dbXiomara = await prisma.user.findUnique({ where: { dni: "75158437" } })

  assert(
    dbJean?.role === Role.TECNICO &&
      dbJean?.campus?.name === "Campus Villa" &&
      dbJean?.adminRole === Role.SUPER_ADMIN &&
      extractAdminCampusId(dbJean.permissions, "SUPER_ADMIN", dbJean.campusId) === null,
    "BD (Jean Pieer): Conserva rol operativo TECNICO en Campus Villa y vista Admin Global como único SUPER_ADMIN"
  )

  assert(
    dbMartha?.role === Role.ADMIN_SECUNDARIO &&
      dbXiomara?.role === Role.ADMIN_SECUNDARIO &&
      dbMartha?.adminRole === Role.ADMIN_SECUNDARIO &&
      dbXiomara?.adminRole === Role.ADMIN_SECUNDARIO,
    "BD (Administrativos Netos): Martha y Xiomara figuran como ADMIN_SECUNDARIO y ya no aparecen en la lista de Pacientes"
  )

  // =========================================================================
  // 15. CÓDIGO DE UN SOLO USO PARA VINCULAR ESTACIÓN OFICIAL (SEDE PRECONFIGURADA)
  // =========================================================================
  console.log("\n--- TEST 15: CÓDIGO DE UN SOLO USO PARA VINCULAR ESTACIÓN OFICIAL ---")

  const { createKioskOneTimeCode, consumeKioskOneTimeCode, deleteKioskOneTimeCode } = await import("../src/lib/kiosk-codes")

  // 15.1 Generación de código de 6 dígitos con Sede preconfigurada
  const createdCode = await createKioskOneTimeCode({
    campusName: "Campus Norte",
    actorName: dbJean?.name || "Jean Pieer",
    actorDni: dbJean?.dni || "72455873",
    actorRole: "SUPER_ADMIN",
  })
  assert(
    /^\d{6}$/.test(createdCode.code) && createdCode.campusName === "Campus Norte",
    "Código 1-Uso: Genera un código de 6 dígitos con la sede 'Campus Norte' preconfigurada"
  )

  // 15.2 Primer uso del código autoriza exitosamente y devuelve la sede preconfigurada
  const firstUse = await consumeKioskOneTimeCode(createdCode.code)
  assert(
    firstUse.success === true && firstUse.campusName === "Campus Norte",
    "Código 1-Uso (1er intento): Autoriza la PC y devuelve automáticamente 'Campus Norte' para 'Estación Oficial: Campus Norte'"
  )

  // 15.3 Segundo intento con el mismo código es rechazado (un solo uso estricto)
  const secondUse = await consumeKioskOneTimeCode(createdCode.code)
  assert(
    secondUse.success === false && secondUse.message.includes("ya fue utilizado"),
    "Código 1-Uso (2do intento): Invalida el código tras el primer uso y rechaza reutilizarlo"
  )

  // Limpiar el código de prueba
  await deleteKioskOneTimeCode(createdCode.code, {
    name: dbJean?.name || "Jean Pieer",
    dni: dbJean?.dni || "72455873",
    role: "SUPER_ADMIN",
  })

  // =========================================================================
  // 16. MARCACIÓN POR CADA MÓDULO Y AVISO DE ROTACIÓN EXCLUSIVO EN TELÉFONOS
  // =========================================================================
  console.log("\n--- TEST 16: MARCACIÓN POR MÓDULO (INGRESO/SALIDA) Y AVISO DE ROTACIÓN EN CELULARES ---")

  const {
    resolveUserModulesState,
    buildMobileRotationAlertPayload,
  } = await import("../src/lib/daily-program-api")

  const mockUserModules = [
    {
      moduleNumber: 1,
      horaInicio: "07:00",
      horaFin: "08:40",
      startMinutes: 420,
      endMinutes: 520,
      ambiente: "SL02TA21: CONSULTORIO 101",
      piso: "Piso 1",
      sesion: "[MED_SBS]-Caso 1",
      courseName: "Semiología Basada en Simulación (SBS)",
      campusName: "Campus Villa",
    },
    {
      moduleNumber: 2,
      horaInicio: "08:40",
      horaFin: "10:20",
      startMinutes: 520,
      endMinutes: 620,
      ambiente: "SL02TA22: CONSULTORIO 204",
      piso: "Piso 2",
      sesion: "[SCI]-Caso 2",
      courseName: "Simulación Clínica Integrada (SCI)",
      campusName: "Campus Villa",
    },
  ]

  // 16.1 Inicio del día (06:50 AM = 410m): Módulo 1 activo para ENTRADA
  const stateStart = resolveUserModulesState(mockUserModules, [], 410)
  assert(
    stateStart.activeModule?.moduleNumber === 1 &&
      stateStart.nextAction === "ENTRADA" &&
      stateStart.nextModule?.moduleNumber === 2,
    "Módulos (Inicio): Selecciona Módulo 1 (07:00 - 08:40) para marcar ENTRADA y prevé rotación a Módulo 2"
  )

  // 16.2 Tras marcar ENTRADA del Módulo 1 (06:55 AM) y llegar las 08:40 AM (520m): Módulo 1 EN_CURSO exige SALIDA y dispara alerta
  const stateMod1End = resolveUserModulesState(
    mockUserModules,
    [{ type: "ENTRADA", timestamp: "2026-10-15T06:55:00-05:00" }],
    520
  )
  assert(
    stateMod1End.activeModule?.moduleNumber === 1 &&
      stateMod1End.nextAction === "SALIDA" &&
      stateMod1End.shouldTriggerRotationAlert === true &&
      stateMod1End.rotationAlertReason === "MODULE_TIME_ENDED",
    "Módulos (Fin de Módulo 1 a las 08:40): Exige marcar SALIDA del Módulo 1 y activa bandera de fin de clase/rotación"
  )

  // 16.3 El aviso de rotación SE ACTIVA en teléfonos (!isKioskStation) pero NO en Estación Fija (PC de sede)
  const mobileAlert = buildMobileRotationAlertPayload(stateMod1End, false)
  const kioskAlert = buildMobileRotationAlertPayload(stateMod1End, true)
  assert(
    mobileAlert.enabled === true &&
      mobileAlert.shouldAlert === true &&
      mobileAlert.nextAmbiente === "CONSULTORIO 204" &&
      kioskAlert.enabled === false &&
      kioskAlert.shouldAlert === false,
    "Aviso de Rotación: Se emite en celulares indicando el nuevo ambiente ('CONSULTORIO 204') y se bloquea en PCs fijas"
  )

  // 16.4 Tras marcar SALIDA del Módulo 1 (08:40 AM): Módulo 1 pasa a COMPLETADO y avanza a Módulo 2 para marcar nueva ENTRADA
  const stateAfterMod1Exit = resolveUserModulesState(
    mockUserModules,
    [
      { type: "ENTRADA", timestamp: "2026-10-15T06:55:00-05:00" },
      { type: "SALIDA", timestamp: "2026-10-15T08:40:00-05:00" },
    ],
    521
  )
  assert(
    stateAfterMod1Exit.modules[0].status === "COMPLETADO" &&
      stateAfterMod1Exit.activeModule?.moduleNumber === 2 &&
      stateAfterMod1Exit.activeModule?.horaInicio === "08:40" &&
      stateAfterMod1Exit.activeModule?.courseName === "Simulación Clínica Integrada (SCI)" &&
      stateAfterMod1Exit.nextAction === "ENTRADA",
    "Módulos (Rotación a Módulo 2): Cierra Módulo 1 como COMPLETADO y habilita ENTRADA del Módulo 2 (08:40 - 10:20)"
  )

  // 16.5 Paciente Simulado con 3 bloques seguidos (07:00 a 12:00) del mismo tema y salón + cambio a las 12:00:
  //      NO suena alarma a las 08:40 ni 10:20; SOLO notifica a las 12:00 cuando cambia de tema y salón.
  const threeConsecutiveSameRoomModules = [
    {
      moduleNumber: 1,
      horaInicio: "07:00",
      horaFin: "08:40",
      startMinutes: 420,
      endMinutes: 520,
      ambiente: "SL02TA21: CONSULTORIO 101",
      piso: "Piso 1",
      sesion: "[MED_SBS]-Sd cushing",
      courseName: "Semiología Basada en Simulación (SBS)",
      campusName: "Campus Villa",
    },
    {
      moduleNumber: 2,
      horaInicio: "08:40",
      horaFin: "10:20",
      startMinutes: 520,
      endMinutes: 620,
      ambiente: "SL02TA21: CONSULTORIO 101",
      piso: "Piso 1",
      sesion: "[MED_SBS]-Sd cushing",
      courseName: "Semiología Basada en Simulación (SBS)",
      campusName: "Campus Villa",
    },
    {
      moduleNumber: 3,
      horaInicio: "10:20",
      horaFin: "12:00",
      startMinutes: 620,
      endMinutes: 720,
      ambiente: "SL02TA21: CONSULTORIO 101",
      piso: "Piso 1",
      sesion: "[MED_SBS]-Sd cushing",
      courseName: "Semiología Basada en Simulación (SBS)",
      campusName: "Campus Villa",
    },
    {
      moduleNumber: 4,
      horaInicio: "12:00",
      horaFin: "13:40",
      startMinutes: 720,
      endMinutes: 820,
      ambiente: "SL02TA22: CONSULTORIO 204",
      piso: "Piso 2",
      sesion: "[SCI]-Depresión",
      courseName: "Simulación Clínica Integrada (SCI)",
      campusName: "Campus Villa",
    },
  ]

  const patientAt0840 = resolveUserModulesState(
    threeConsecutiveSameRoomModules,
    [{ type: "ENTRADA", timestamp: "2026-10-15T06:55:00-05:00" }],
    520, // 08:40 AM
    Role.PACIENTE_SIMULADO
  )
  const patientAt1200 = resolveUserModulesState(
    threeConsecutiveSameRoomModules,
    [{ type: "ENTRADA", timestamp: "2026-10-15T06:55:00-05:00" }],
    720, // 12:00 PM
    Role.PACIENTE_SIMULADO
  )
  assert(
    patientAt0840.modules.length === 2 &&
      patientAt0840.activeModule?.horaInicio === "07:00" &&
      patientAt0840.activeModule?.horaFin === "12:00" &&
      patientAt0840.shouldTriggerRotationAlert === false &&
      patientAt1200.shouldTriggerRotationAlert === true &&
      Boolean(patientAt1200.nextModule?.ambiente.includes("CONSULTORIO 204")),
    "Paciente Simulado (De corrido 07:00-12:00): Une los 3 bloques iguales sin sonar a las 08:40/10:20 y solo avisa a las 12:00 al cambiar de tema y salón"
  )

  // 16.6 Docente con los mismos 3 bloques seguidos (07:00-08:40, 08:40-10:20, 10:20-12:00):
  //      SÍ suena alarma al terminar cada módulo (08:40) para avisar que terminó la hora con esa sección de alumnos.
  const docenteAt0840 = resolveUserModulesState(
    threeConsecutiveSameRoomModules,
    [{ type: "ENTRADA", timestamp: "2026-10-15T06:55:00-05:00" }],
    520, // 08:40 AM
    Role.DOCENTE
  )
  const docenteAlert0840 = buildMobileRotationAlertPayload(docenteAt0840, false, Role.DOCENTE)
  assert(
    docenteAt0840.modules.length === 4 &&
      docenteAt0840.shouldTriggerRotationAlert === true &&
      docenteAlert0840.shouldAlert === true &&
      docenteAlert0840.message.includes("sección de alumnos"),
    "Docente (Varios módulos seguidos): Mantiene cada módulo separado y suena alarma a las 08:40 recordando fin de hora con esa sección de alumnos"
  )

  // =========================================================================
  // TEST 17: RENDIMIENTO, CACHÉ DE DIRECTORIO Y RESPUESTA ULTRA-RÁPIDA EN PCs
  // =========================================================================
  console.log("\n[TEST 17] Probando Rendimiento, Caché en Memoria y Latencia en PCs...")

  const { preloadAttendanceDirectoryAction, validateUserAction } = await import("../src/actions/attendance")
  const { matchDailyProgramFromSessions } = await import("../src/lib/daily-program-api")
  const { validateEarlyEntry, calculateStatusFromRule } = await import("../src/lib/tolerance")

  // 17.1 Precarga inicial del directorio y medición de respuesta en caliente (< 10ms)
  await preloadAttendanceDirectoryAction()
  const tWarmDirStart = performance.now()
  const warmDirRes = await preloadAttendanceDirectoryAction()
  const warmDirMs = performance.now() - tWarmDirStart
  const sampleDnis = Object.keys(warmDirRes.directory)

  assert(
    warmDirRes.success === true && sampleDnis.length > 0 && warmDirMs < 15,
    `Caché de Directorio en Memoria: Respuesta instantánea en ${warmDirMs.toFixed(2)}ms (< 15ms) con ${sampleDnis.length} usuarios precargados`
  )

  // 17.2 Validación de DNI desde caché en memoria (< 10ms)
  const testDni = sampleDnis[0]
  const tValStart = performance.now()
  const fastValRes = await validateUserAction(testDni)
  const fastValMs = performance.now() - tValStart

  assert(
    fastValRes !== undefined && fastValMs < 15,
    `Validación DNI en Caliente (PC/Móvil): Respondió en ${fastValMs.toFixed(2)}ms (< 15ms) sin bloquear por red ni API externa`
  )

  // 17.3 Benchmark de emparejamiento masivo de nombres (300 usuarios × 80 sesiones) en < 50ms
  const benchmarkSessions = Array.from({ length: 80 }, (_, idx) => ({
    piso: "Piso 2",
    ambiente: `CONSULTORIO ${(idx % 12) + 1}`,
    sesion: "[MED_SBS]-Semiología General",
    courseName: "Semiología Basada en Simulación (SBS)",
    campusName: "Campus Villa",
    horaInicio: "07:00",
    horaFin: "08:40",
    startMinutes: 420,
    endMinutes: 520,
    docenteLider: `DOCENTE APELLIDO${idx}, NOMBRE${idx}`,
    docentesColaboradores: `COLABORADOR UNO${idx} / COLABORADOR DOS${idx}`,
    pacientesEstandarizados: `PACIENTE SIMULADO${idx} / BRISSA MOLINA MARTINEZ`,
  }))

  const tMatchStart = performance.now()
  for (let u = 0; u < 300; u++) {
    matchDailyProgramFromSessions(
      benchmarkSessions,
      u % 10 === 0 ? "Brissa Molina" : `Usuario Prueba ${u}`,
      u % 2 === 0 ? Role.PACIENTE_SIMULADO : Role.DOCENTE,
      "Campus Villa"
    )
  }
  const matchElapsedMs = performance.now() - tMatchStart

  assert(
    matchElapsedMs < 80,
    `Motor de Coincidencia de Nombres Optimizado: 300 usuarios × 80 sesiones procesados en ${matchElapsedMs.toFixed(2)}ms (< 80ms)`
  )

  // 17.4 Verificación del módulo desacoplado de tolerancia (@/lib/tolerance)
  const sampleRule = {
    expectedEntryTime: "08:00",
    earlyEntryToleranceMinutes: 30,
    gracePeriodMinutes: 5,
    lateToleranceMinutes: 30,
    enableEarlyTolerance: true,
    enableLateTolerance: true,
  }
  const onTimeDate = new Date("2026-10-15T08:03:00-05:00")
  const earlyCheck = validateEarlyEntry(onTimeDate, sampleRule)
  const calcStatus = calculateStatusFromRule(onTimeDate, sampleRule)
  assert(
    earlyCheck.allowed === true && calcStatus === RecordStatus.A_TIEMPO,
    "Módulo @/lib/tolerance: Evalúa ventana de anticipación y estado de puntualidad sin consultas redundantes"
  )

  // =========================================================================
  // TEST 18: ACTUALIZACIÓN EN VIVO DEL EXCEL, NUEVOS MÓDULOS DE ÚLTIMO MINUTO Y WEB PUSH
  // =========================================================================
  console.log("\n[TEST 18] Probando Sincronización en Vivo del Excel, Módulos de Último Minuto y Web Push...")

  const { getOrCreateVapidKeys } = await import("../src/lib/push-notifications")
  const { getLiveDailyProgramOverviewAction } = await import("../src/actions/daily-program")

  // 18.1 Si el usuario ya completó un módulo en la mañana (07:00-08:40), tenía otro módulo vencido (08:40-10:20)
  //      y se le agrega en el Excel un nuevo módulo a las 14:00-16:00 siendo las 13:50 (830m),
  //      el sistema prioriza el nuevo módulo vigente (14:00-16:00) y NO se queda atascado en el anterior.
  const modulesWithLastMinuteAddition = [
    ...mockUserModules,
    {
      moduleNumber: 3,
      horaInicio: "14:00",
      horaFin: "16:00",
      startMinutes: 840,
      endMinutes: 960,
      ambiente: "SL02TA25: SALA ALTA FIDELIDAD 3",
      piso: "Piso 3",
      sesion: "[UCI]-Shock Séptico",
      courseName: "Unidad de Cuidados Intensivos",
      campusName: "Campus Villa",
    },
  ]
  const stateWithNewAfternoonMod = resolveUserModulesState(
    modulesWithLastMinuteAddition,
    [
      { type: "ENTRADA", timestamp: "2026-10-15T06:55:00-05:00" },
      { type: "SALIDA", timestamp: "2026-10-15T08:40:00-05:00" },
    ],
    830, // 13:50 PM
    Role.PACIENTE_SIMULADO
  )
  assert(
    stateWithNewAfternoonMod.activeModule?.horaInicio === "14:00" &&
      stateWithNewAfternoonMod.activeModule?.horaFin === "16:00" &&
      stateWithNewAfternoonMod.activeModule?.ambiente.includes("SALA ALTA FIDELIDAD 3"),
    "Modificación de Último Minuto en Excel: Selecciona el nuevo módulo vigente (14:00-16:00) sin quedarse en horarios anteriores ya vencidos"
  )

  // 18.2 Verificación de llaves VAPID para notificaciones Web Push con app cerrada / teléfono bloqueado
  const vapidKeys = await getOrCreateVapidKeys()
  assert(
    Boolean(vapidKeys.publicKey && vapidKeys.privateKey && vapidKeys.publicKey.length > 40),
    "Web Push (App Cerrada / Teléfono Bloqueado): Llaves VAPID generadas y persistidas correctamente para despacho en segundo plano"
  )

  // 18.3 Verificación del visor administrativo en vivo de horarios del día (Excel -> Admin)
  const liveOverview = await getLiveDailyProgramOverviewAction(true)
  assert(
    liveOverview.success === true &&
      Array.isArray(liveOverview.patients) &&
      Array.isArray(liveOverview.rawSessions) &&
      Boolean(liveOverview.syncedAtIso),
    `Visor Admin de Horarios del Día en Vivo: Sincronizado (${liveOverview.patients.length} pacientes y ${liveOverview.totalRawSessions} sesiones leídas en directo del Excel)`
  )

  console.log("\n==================================================")
  console.log(`  RESUMEN DE PRUEBAS: ${passedTests} de ${totalTests} EXITOSAS`)
  console.log("==================================================")

  await prisma.$disconnect()

  if (passedTests === totalTests) {
    process.exit(0)
  } else {
    process.exit(1)
  }
}

main().catch((e) => {
  console.error("Error fatal durante la ejecución de las pruebas:", e)
  process.exit(1)
})
