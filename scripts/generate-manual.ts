import { jsPDF } from "jspdf"
import autoTable from "jspdf-autotable"
import fs from "fs"
import path from "path"

type RGB = [number, number, number]

const COLORS = {
  NAVY: [11, 27, 61] as RGB,        // #0B1B3D
  BLUE: [25, 103, 210] as RGB,      // #1967D2
  INDIGO: [79, 70, 229] as RGB,     // #4F46E5
  EMERALD: [5, 150, 105] as RGB,    // #059669
  PURPLE: [126, 34, 206] as RGB,    // #7E22CE
  AMBER: [217, 119, 6] as RGB,      // #D97706
  TEXT_DARK: [30, 41, 59] as RGB,   // #1E293B
  TEXT_MUTED: [100, 116, 139] as RGB, // #64748B
  BG_LIGHT: [241, 245, 249] as RGB, // #F1F5F9
}

class ManualBuilder {
  doc: jsPDF
  y: number
  accentColor: RGB
  manualTitle: string
  audienceBadge: string

  constructor(manualTitle: string, subtitle: string, audienceBadge: string, accentColor: RGB) {
    this.doc = new jsPDF({
      orientation: "portrait",
      unit: "mm",
      format: "a4",
    })
    this.y = 64
    this.accentColor = accentColor
    this.manualTitle = manualTitle
    this.audienceBadge = audienceBadge
    this.drawHeaderBanner(manualTitle, subtitle, audienceBadge)
  }

  private drawHeaderBanner(title: string, subtitle: string, badge: string) {
    // Fondo principal oscuro
    this.doc.setFillColor(COLORS.NAVY[0], COLORS.NAVY[1], COLORS.NAVY[2])
    this.doc.rect(0, 0, 210, 52, "F")

    // Franja inferior de color según el rol
    this.doc.setFillColor(this.accentColor[0], this.accentColor[1], this.accentColor[2])
    this.doc.rect(0, 50, 210, 3, "F")

    // Etiqueta superior
    this.doc.setFillColor(this.accentColor[0], this.accentColor[1], this.accentColor[2])
    this.doc.roundedRect(18, 10, 95, 7, 2, 2, "F")
    this.doc.setTextColor(255, 255, 255)
    this.doc.setFont("helvetica", "bold")
    this.doc.setFontSize(8)
    this.doc.text(badge.toUpperCase(), 22, 14.8)

    // Título principal
    this.doc.setTextColor(255, 255, 255)
    this.doc.setFont("helvetica", "bold")
    this.doc.setFontSize(17)
    this.doc.text(title, 18, 27)

    // Subtítulo
    this.doc.setFont("helvetica", "normal")
    this.doc.setFontSize(10)
    this.doc.setTextColor(203, 213, 225)
    this.doc.text(subtitle, 18, 35)

    this.doc.setFontSize(8.5)
    this.doc.setTextColor(148, 163, 184)
    this.doc.text(
      "Centro de Simulacion Clinica - Universidad Cientifica del Sur (ClinSim UCSUR) | Version 2026",
      18,
      43
    )
  }

  checkPageBreak(neededSpace = 20) {
    if (this.y + neededSpace > 274) {
      this.doc.addPage()
      // Mini cabecera en páginas interiores
      this.doc.setFillColor(COLORS.NAVY[0], COLORS.NAVY[1], COLORS.NAVY[2])
      this.doc.rect(0, 0, 210, 14, "F")
      this.doc.setFillColor(this.accentColor[0], this.accentColor[1], this.accentColor[2])
      this.doc.rect(0, 14, 210, 1.2, "F")
      this.doc.setTextColor(255, 255, 255)
      this.doc.setFont("helvetica", "bold")
      this.doc.setFontSize(8.5)
      this.doc.text(`ClinSim UCSUR  |  ${this.manualTitle}`, 18, 9.2)
      this.y = 24
    }
  }

  addSectionTitle(title: string) {
    this.checkPageBreak(22)
    this.doc.setFillColor(238, 242, 255)
    this.doc.roundedRect(18, this.y - 5, 174, 10, 2, 2, "F")
    this.doc.setFillColor(this.accentColor[0], this.accentColor[1], this.accentColor[2])
    this.doc.rect(18, this.y - 5, 3, 10, "F")

    this.doc.setTextColor(COLORS.NAVY[0], COLORS.NAVY[1], COLORS.NAVY[2])
    this.doc.setFont("helvetica", "bold")
    this.doc.setFontSize(11.5)
    this.doc.text(title, 25, this.y + 1.8)
    this.y += 12
  }

  addSubTitle(subtitle: string) {
    this.checkPageBreak(14)
    this.doc.setTextColor(this.accentColor[0], this.accentColor[1], this.accentColor[2])
    this.doc.setFont("helvetica", "bold")
    this.doc.setFontSize(10)
    this.doc.text(subtitle, 18, this.y)
    this.y += 6
  }

  addParagraph(text: string) {
    this.doc.setFont("helvetica", "normal")
    this.doc.setFontSize(9.3)
    this.doc.setTextColor(COLORS.TEXT_DARK[0], COLORS.TEXT_DARK[1], COLORS.TEXT_DARK[2])
    const lines = this.doc.splitTextToSize(text, 172)
    for (const line of lines) {
      this.checkPageBreak(7)
      this.doc.text(line, 18, this.y)
      this.y += 5
    }
    this.y += 2
  }

  addBullet(label: string, description: string) {
    this.doc.setFontSize(9.2)
    const fullText = `${label ? label + ": " : ""}${description}`
    const lines = this.doc.splitTextToSize(fullText, 166)
    this.checkPageBreak(lines.length * 5 + 3)

    // Punto viñeta
    this.doc.setFillColor(this.accentColor[0], this.accentColor[1], this.accentColor[2])
    this.doc.circle(20.5, this.y - 1.2, 1.1, "F")

    for (let i = 0; i < lines.length; i++) {
      if (i === 0 && label) {
        this.doc.setFont("helvetica", "bold")
        this.doc.setTextColor(COLORS.NAVY[0], COLORS.NAVY[1], COLORS.NAVY[2])
        this.doc.text(lines[i], 24, this.y)
      } else {
        this.doc.setFont("helvetica", "normal")
        this.doc.setTextColor(COLORS.TEXT_DARK[0], COLORS.TEXT_DARK[1], COLORS.TEXT_DARK[2])
        this.doc.text(lines[i], 24, this.y)
      }
      this.y += 4.9
    }
    this.y += 1.2
  }

  addCalloutBox(title: string, text: string, boxColor: RGB = this.accentColor) {
    const lines = this.doc.splitTextToSize(text, 162)
    const boxHeight = lines.length * 4.8 + 13
    this.checkPageBreak(boxHeight + 6)

    this.doc.setFillColor(248, 250, 252)
    this.doc.setDrawColor(boxColor[0], boxColor[1], boxColor[2])
    this.doc.setLineWidth(0.5)
    this.doc.roundedRect(18, this.y, 174, boxHeight, 2.5, 2.5, "FD")

    this.doc.setFillColor(boxColor[0], boxColor[1], boxColor[2])
    this.doc.rect(18, this.y, 3.5, boxHeight, "F")

    this.doc.setFont("helvetica", "bold")
    this.doc.setFontSize(9.5)
    this.doc.setTextColor(boxColor[0], boxColor[1], boxColor[2])
    this.doc.text(title, 25, this.y + 6)

    this.doc.setFont("helvetica", "normal")
    this.doc.setFontSize(8.9)
    this.doc.setTextColor(COLORS.TEXT_DARK[0], COLORS.TEXT_DARK[1], COLORS.TEXT_DARK[2])
    let lineY = this.y + 11.5
    for (const line of lines) {
      this.doc.text(line, 25, lineY)
      lineY += 4.8
    }

    this.y += boxHeight + 5
  }

  addTable(head: string[], body: string[][]) {
    this.checkPageBreak(28)
    autoTable(this.doc, {
      startY: this.y,
      margin: { left: 18, right: 18 },
      head: [head],
      body,
      headStyles: {
        fillColor: this.accentColor,
        textColor: [255, 255, 255],
        fontStyle: "bold",
        fontSize: 8.5,
      },
      bodyStyles: {
        fontSize: 8.2,
        textColor: COLORS.TEXT_DARK,
        cellPadding: 2.8,
      },
      alternateRowStyles: {
        fillColor: [248, 250, 252],
      },
    })
    // @ts-ignore
    this.y = (this.doc as any).lastAutoTable.finalY + 8
  }

  save(filePaths: string[]) {
    const pageCount = (this.doc.internal as any).getNumberOfPages()
    for (let i = 1; i <= pageCount; i++) {
      this.doc.setPage(i)
      this.doc.setDrawColor(226, 232, 240)
      this.doc.line(18, 282, 192, 282)
      this.doc.setFont("helvetica", "normal")
      this.doc.setFontSize(7.8)
      this.doc.setTextColor(COLORS.TEXT_MUTED[0], COLORS.TEXT_MUTED[1], COLORS.TEXT_MUTED[2])
      this.doc.text(
        `ClinSim UCSUR - ${this.manualTitle} (${this.audienceBadge})`,
        18,
        287
      )
      this.doc.text(`Pagina ${i} de ${pageCount}`, 192, 287, { align: "right" })
    }

    const buffer = Buffer.from(this.doc.output("arraybuffer"))
    for (const fp of filePaths) {
      const dir = path.dirname(fp)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
      fs.writeFileSync(fp, buffer)
      console.log(`✓ PDF generado: ${fp}`)
    }
  }
}

// ============================================================================
// 1. MANUAL DE USUARIO FINAL (DOCENTES, TÉCNICOS Y PACIENTES SIMULADOS)
// IMPORTANTE: NO menciona cómo vincular una PC ni el botón secreto de candado.
// ============================================================================
function buildEndUserManual(outputDirs: string[]) {
  const m = new ManualBuilder(
    "Manual del Usuario Final - Marcacion de Asistencia",
    "Guia rapida para Docentes, Tecnicos de Simulacion y Pacientes Simulados",
    "Usuarios Finales (Movil y Sede)",
    COLORS.BLUE
  )

  m.addSectionTitle("1. Bienvenida y Proposito del Portal de Asistencia")
  m.addParagraph(
    "El Portal de Asistencia ClinSim UCSUR permite a los Pacientes Simulados, Docentes y Tecnicos de Simulacion registrar su ingreso y salida de manera instantanea (en menos de 1 segundo) directamente desde su telefono celular al llegar al campus universitario, o desde la computadora habilitada en la oficina de Simulacion Clinica."
  )
  m.addCalloutBox(
    "Ventaja Principal: Cero Colas y Rumbo Directo a tu Ambiente",
    "Ya no necesitas subir hasta la oficina administrativa para marcar tu entrada y luego bajar a tu consultorio. Apenas ingreses al campus universitario con el GPS de tu celular activado, puedes marcar desde la entrada de tu pabellon o frente a tu ambiente asignado y ver al instante que consultorio te toca."
  )

  m.addSectionTitle("2. Como Instalar la App en la Pantalla Principal de tu Celular")
  m.addParagraph(
    "El sistema funciona como una Aplicacion Web Progresiva (PWA) que se adapta automaticamente a cualquier tamano y modelo de celular (Android o iPhone) sin ocupar espacio de memoria:"
  )
  m.addBullet(
    "En celulares Android (Google Chrome)",
    "Abre el enlace oficial del portal de asistencia, toca el icono de tres puntos (arriba a la derecha) y selecciona 'Instalar aplicacion' o 'Agregar a la pantalla principal'. Aparecera el icono de ClinSim UCSUR junto a tus demas aplicaciones."
  )
  m.addBullet(
    "En iPhone / iOS (Safari)",
    "Abre el enlace en Safari, toca el boton 'Compartir' (cuadrado con flecha hacia arriba en la barra inferior) y selecciona 'Agregar a inicio'. Toca 'Agregar' para finalizar."
  )

  m.addSectionTitle("3. Requisitos para Marcar desde tu Celular (GPS en Campus)")
  m.addParagraph(
    "Para garantizar la transparencia de los horarios de ingreso, la marcacion desde telefonos celulares requiere encontrarse fisicamente dentro de cualquiera de las sedes autorizadas de la Universidad Cientifica del Sur:"
  )
  m.addTable(
    ["Sede Universitaria", "Verificacion en Celular", "Estado en Pantalla"],
    [
      ["Campus Villa (Chorrillos)", "GPS Activo dentro del campus", "GPS Activo: Campus Villa"],
      ["Campus Norte (Los Olivos)", "GPS Activo dentro del campus", "GPS Activo: Campus Norte"],
      ["Campus Ate", "GPS Activo dentro del campus", "GPS Activo: Campus Ate"],
      ["Campus Aramburu (Miraflores)", "GPS Activo dentro del campus", "GPS Activo: Campus Aramburu"],
    ]
  )
  m.addBullet(
    "Permiso de Ubicacion",
    "La primera vez que abras la aplicacion en tu celular, presiona 'Permitir mientras se usa la app' cuando el navegador solicite acceso a tu ubicacion GPS."
  )
  m.addBullet(
    "Restriccion Fuera de la Universidad",
    "Si intentas marcar desde tu casa o en el transporte antes de llegar a la universidad, el sistema indicara a cuantos metros te encuentras de la sede mas cercana y no permitira el registro hasta que ingreses al perimetro del campus."
  )

  m.addSectionTitle("4. Paso a Paso para Registrar tu Entrada o Salida")
  m.addBullet(
    "Paso 1 - Ingresa tu DNI (8 digitos)",
    "Escribe los 8 digitos de tu DNI en el campo principal. El sistema no te pedira elegir tu rol ni tu curso manualmente: todo se detecta de forma automatica."
  )
  m.addBullet(
    "Paso 2 - Activa 'Recordar mi DNI en este celular'",
    "Marca la casilla 'Recordar mi DNI en este celular'. Asi, desde manana tu DNI ya aparecera escrito al abrir la app y podras marcar con un solo toque."
  )
  m.addBullet(
    "Paso 3 - Confirmacion Instantanea de Datos y Ambiente",
    "Al completar los 8 digitos, veras de inmediato tu Nombre Completo, Rol, Sede detectada, Horario programado del dia y el Nombre del Ambiente / Consultorio asignado."
  )
  m.addBullet(
    "Paso 4 - Presiona 'Confirmar Asistencia'",
    "Si es tu primer registro del dia, el sistema registrara tu ENTRADA automaticamente. Cuando termines tu jornada o simulacion y vuelvas a ingresar tu DNI, el sistema registrara automaticamente tu SALIDA."
  )

  m.addSectionTitle("5. Informacion Especifica segun tu Perfil")
  m.addSubTitle("A) Pacientes Simulados y Docentes")
  m.addBullet(
    "Sincronizacion con la Programacion Diaria",
    "El sistema consulta automaticamente la programacion oficial del dia y te muestra en pantalla el Curso y el Nombre exacto del Consultorio o Sala de Alta Fidelidad donde debes presentarte (por ejemplo: 'CONSULTORIO 1 - L 107' o 'SALA ALTA FIDELIDAD 1 - OPERACIONES L 112')."
  )
  m.addBullet(
    "Multiples Sesiones en el Mismo Dia",
    "Si tienes varias sesiones programadas en el dia, el sistema toma como hora de ingreso tu primera sesion y como hora de salida el cierre de tu ultima sesion."
  )

  m.addSubTitle("B) Tecnicos de Simulacion")
  m.addParagraph(
    "El sistema valida automaticamente tu turno del dia segun el Cronograma Mensual vigente (incluyendo rotaciones entre sedes y guardias dominicales):"
  )
  m.addTable(
    ["Turno Oficial", "Dias", "Horario de Jornada", "Tolerancia Anticipada"],
    [
      ["Manana (M)", "Lunes a Domingo", "06:00 AM - 03:00 PM", "Desde 15 min antes (05:45 AM)"],
      ["Intermedio L-V (I)", "Lunes a Viernes", "09:00 AM - 06:00 PM", "Desde 15 min antes (08:45 AM)"],
      ["Intermedio Sabado (I)", "Sabados", "08:00 AM - 05:00 PM", "Desde 15 min antes (07:45 AM)"],
      ["Intermedio Domingo (I)", "Domingos", "10:00 AM - 07:00 PM", "Desde 15 min antes (09:45 AM)"],
      ["Tarde (T)", "Lunes a Sabado", "01:00 PM - 10:00 PM", "Desde 15 min antes (12:45 PM)"],
      ["Comision / Evento (EV)", "Segun programacion", "Evento Especial / Provincia", "No requiere marcar asistencia"],
    ]
  )

  m.addSectionTitle("6. Modo Contingencia Local (Si falla el Internet)")
  m.addParagraph(
    "En caso de que la red movil o el Wi-Fi de la sede presente una caida temporal en el momento de tu llegada, el sistema guarda tu marcacion con su hora exacta en la memoria segura del dispositivo y la sincroniza automaticamente apenas se restablezca la conexion."
  )

  const paths = outputDirs.map((d) =>
    path.join(d, "1_Manual_Usuario_Final_Marcacion_Asistencia.pdf")
  )
  m.save(paths)
}

// ============================================================================
// 2. MANUAL EXCLUSIVO DE SUPER ADMINISTRADOR (ACCESO TOTAL + ESTACIÓN OFICIAL + LOGS)
// ============================================================================
function buildSuperAdminManual(outputDirs: string[]) {
  const m = new ManualBuilder(
    "Manual del Super Administrador (Acceso Total)",
    "Guia completa de Administracion Global, Estaciones Oficiales, Jerarquia de Roles y Auditoria de Logs",
    "Nivel 4: Super Admin (Confidencial)",
    COLORS.INDIGO
  )

  m.addSectionTitle("1. Alcance del Rol Super Administrador")
  m.addParagraph(
    "El Super Administrador posee el maximo nivel jerarquico dentro de ClinSim UCSUR. Tiene visibilidad global sobre las 4 sedes universitarias (Campus Villa, Campus Norte, Campus Ate y Campus Aramburu) sin que ello altere su sede operativa personal (por ejemplo, si tambien labora como Tecnico en una sede especifica)."
  )
  m.addTable(
    ["Capacidad / Modulo", "Super Admin", "Admin General", "Coord. Pacientes", "Admin por Sede"],
    [
      ["Alcance de Sedes", "Todas las Sedes", "Todas las Sedes", "Global o 1 Sede", "Solo su Sede"],
      ["Alcance de Roles Operativos", "Todos", "Todos", "Solo Pacientes Sim.", "Todos en su Sede"],
      ["Designar nuevos Super Admin", "SI (Exclusivo)", "NO", "NO", "NO"],
      ["Ver Informe de Logs (Auditoria)", "SI (Exclusivo)", "NO", "NO", "NO"],
      ["Generar Codigos 1 Uso (Estacion Fija)", "SI (Siempre)", "Con permiso Kiosk", "Con permiso Kiosk", "Con permiso Kiosk"],
      ["Configurar Reglas y Horas Extras", "SI", "SI", "NO", "Segun permisos"],
    ]
  )

  m.addSectionTitle("2. CONFIDENCIAL: Como Vincular una PC como 'Estacion Oficial' (Sin GPS)")
  m.addCalloutBox(
    "Informacion Reservada para Administradores Autorizados",
    "Las computadoras de escritorio de las oficinas tienen bloqueado el GPS por politicas de TI. Para que el personal pueda marcar en la PC de la oficina sin GPS, el sistema cuenta con un boton secreto e imperceptible que transforma esa PC en una 'Estacion Oficial'."
  )
  m.addSubTitle("Ubicacion del Boton Secreto en el Portal de Asistencia")
  m.addBullet(
    "Icono Discreto de Candado",
    "En la pantalla principal de marcacion, observa la barra superior de estado de ubicacion (donde dice 'Activa el GPS de tu celular...'). En el extremo derecho de esa barra hay un pequeno icono de candado casi imperceptible para el usuario final. Al hacer clic sobre ese candado, se abre la ventana de verificacion."
  )

  m.addSubTitle("Metodo 1 (Por Defecto): Vincular mediante Codigo de Un Solo Uso (6 digitos)")
  m.addBullet(
    "Paso 1 - Generar el Codigo en el Dashboard",
    "Ingresa al Panel de Administracion -> pestana 'Control de Acceso'. En la tarjeta superior 'Vincular PC de Sede mediante Codigo de Un Solo Uso', elige la sede (ej. Campus Villa) y presiona 'Generar Codigo (1 Uso)'. El sistema creara un codigo de 6 digitos que ya tiene preconfigurada esa sede."
  )
  m.addBullet(
    "Paso 2 - Ingresar el Codigo en la PC de la Sede",
    "En la PC de la oficina, haz clic en el icono discreto de candado. De forma automatica aparecera la casilla para escribir el Codigo de 6 digitos (sin necesidad de elegir la sede ni exponer tu contrasena)."
  )
  m.addBullet(
    "Paso 3 - Activacion e Invalidacion Automatica",
    "Al presionar 'Vincular con Codigo', la PC quedara autorizada permanentemente y mostrara la etiqueta verde 'Estacion Oficial: <Sede configurada>'. En ese mismo instante el codigo queda QUEMADO (Estado: Usado) y no servira nunca mas si alguien intenta reutilizarlo en otro equipo."
  )

  m.addSubTitle("Metodo 2 (Alternativo): Vincular con Usuario y Contrasena")
  m.addBullet(
    "Cambio a Credenciales",
    "Dentro de la misma ventana del candado, puedes presionar el enlace inferior 'Cambiar a Usuario y Contrasena ->', seleccionar la sede, ingresar tu DNI y contrasena de Super Admin (o de un Admin con el permiso 'Vincular Estacion Fija') y presionar 'Vincular con Credenciales'."
  )
  m.addBullet(
    "Como Desvincular una PC",
    "Si se cambia de computadora en la oficina, haz clic nuevamente en el candado discreto y presiona 'Desvincular este equipo'."
  )

  m.addSectionTitle("3. Gestion de Administradores y Separacion de Sede Operativa vs Admin")
  m.addParagraph(
    "Desde la pestana 'Control de Acceso', el Super Admin gestiona todas las cuentas con acceso al Dashboard:"
  )
  m.addBullet(
    "Independencia Total de Sedes",
    "Si un Tecnico, Docente o Paciente Simulado es promovido a Administrador, su sede base de trabajo operativo (ej. Tecnico de Campus Villa) se mantiene 100% intacta e independiente de la sede que visualiza como Administrador (puede ver 'Todas las Sedes' o una sede especifica sin afectar su asistencia diaria)."
  )
  m.addBullet(
    "Administrativos Netos",
    "Cuando se crea un administrador que no es Tecnico ni Docente ni Paciente (Administrativo Neto), el sistema lo registra con rol netamente administrativo para que JAMAS aparezca mezclado en las listas ni reportes de Pacientes Simulados."
  )
  m.addBullet(
    "Los 4 Niveles de Rol Administrativo",
    "Al crear o editar un administrador puedes elegir entre: (1) Admin por Sede, (2) Coordinador de Pacientes Simulados, (3) Admin General, o (4) Super Admin, ademas de activar o desactivar manualmente cada uno de los 8 modulos de permisos."
  )

  m.addSectionTitle("4. Modulo Exclusivo: Informe de Logs (Auditoria Total)")
  m.addParagraph(
    "Solo el Super Admin visualiza en el menu lateral la pestana 'Informe de Logs'. Este modulo registra cronologicamente y en tiempo real todas las acciones sensibles del sistema:"
  )
  m.addBullet(
    "Accesos y Seguridad (AUTH)",
    "Cada inicio de sesion exitoso en el Dashboard, intentos fallidos por contrasena incorrecta y cambios obligatorios de clave."
  )
  m.addBullet(
    "Estaciones Oficiales (KIOSK)",
    "Generacion de codigos de 1 solo uso, canje exitoso de codigos en PCs de sede, intentos de reutilizar codigos ya quemados y vinculaciones con contrasena."
  )
  m.addBullet(
    "Administradores, Personal y Reglas",
    "Creacion, promocion o revocacion de administradores, cargas masivas de Excel, cambios en cronogramas de tecnicos y ajustes en parametros de horas extras o tolerancias."
  )

  m.addSectionTitle("5. Modulos Operativos, Horas Extras y Cronograma Inteligente")
  m.addBullet(
    "Control de Horas Extras (Umbral Minimo Configurable)",
    "En 'Exportacion -> Configurar H. Extras', puedes definir a partir de cuantos minutos adicionales despues de las 9 horas de jornada se contabiliza como Hora Extra (por defecto 60 minutos = 1 hora completa). Si un tecnico se queda 45 minutos, figura como exceso bruto pero computa 0 horas reconocidas; si cumple >= 60 minutos, se contabiliza automaticamente."
  )
  m.addBullet(
    "Cronograma Mensual de Tecnicos (Excel + IA OCR + Editor Interactivo)",
    "Permite subir la matriz mensual en Excel o imagen (OCR), previsualizar el calendario dividido por Sedes (Villa, Norte, Ate, Aramburu) con domingos resaltados, editar cualquier celda en vivo (incluyendo rotaciones M(N), T(V) y comisiones en provincia 'EV') y publicarlo con efecto inmediato."
  )

  const paths = outputDirs.map((d) =>
    path.join(d, "2_Manual_Super_Admin_Acceso_Total.pdf")
  )
  m.save(paths)
}

// ============================================================================
// 3. MANUAL DE ADMINISTRADOR GENERAL (MULTISEDE - NIVEL 3)
// ============================================================================
function buildGlobalAdminManual(outputDirs: string[]) {
  const m = new ManualBuilder(
    "Manual del Administrador General (Multisede)",
    "Guia de operacion global para supervision de las 4 sedes, reportes RRHH, cronogramas y catalogos",
    "Nivel 3: Admin General",
    COLORS.BLUE
  )

  m.addSectionTitle("1. Alcance y Permisos del Administrador General")
  m.addParagraph(
    "El Administrador General ('ADMIN_GLOBAL') cuenta con vision global ('Vista: Todas las Sedes') para supervisar la operacion diaria del Centro de Simulacion Clinica en Campus Villa, Campus Norte, Campus Ate y Campus Aramburu."
  )
  m.addCalloutBox(
    "Diferencia frente al Super Admin",
    "El Administrador General puede gestionar todos los modulos operativos y administrativos que le hayan sido habilitados, pero por seguridad institucional no tiene acceso a la pestana 'Informe de Logs' ni puede crear o modificar cuentas de rango 'Super Admin'."
  )

  m.addSectionTitle("2. Modulos Disponibles en el Panel de Control")
  m.addTable(
    ["Modulo", "Funciones Principales para el Admin General"],
    [
      ["Resumen", "Monitoreo en vivo de las entradas y salidas del dia en todas las sedes y flujo semanal."],
      ["Metricas", "Analitica de puntualidad, comparativa entre sedes, distribucion por turnos y ranking de incidencias."],
      ["Exportacion", "Filtros avanzados, auditoria de Horas Extras (>= 1h) y descarga de Excel (6 hojas), CSV y PDF."],
      ["Horarios y Tolerancias", "Configuracion de horas de entrada, minutos de gracia, limite de falta y guardia dominical."],
      ["Cronograma Tecnicos", "Carga de rol mensual en Excel o Imagen (OCR) y edicion interactiva por sedes y estado EV."],
      ["Personal Operativo", "Alta individual, carga masiva en Excel, edicion y baja de Docentes, Tecnicos y Pacientes."],
      ["Sedes & Cursos", "Gestion del catalogo de cursos academicos y coordenadas perimetricas de campus."],
    ]
  )

  m.addSectionTitle("3. Exportacion de Reportes y Calculo de Horas Extras")
  m.addBullet(
    "Vista Detallada vs Consolidado RRHH",
    "En la pestana 'Exportacion', puedes alternar entre '1. Marcaciones Detalladas' (cada ingreso y salida individual) y '2. Consolidado por Colaborador y H. Extras' (resumen por persona con tasa de puntualidad y horas extras reconocidas)."
  )
  m.addBullet(
    "Libro Excel Multi-Hoja (6 Hojas)",
    "Al presionar 'Descargar Excel (.xlsx)', el sistema genera un libro empresarial con 6 pestanas: (1) Marcaciones Detalladas, (2) Consolidado RRHH, (3) Horas Extras Detalladas, (4) Resumen por Sede, (5) Resumen por Turno y (6) Metricas de Control (KPIs)."
  )

  m.addSectionTitle("4. Gestion del Cronograma Mensual de Tecnicos y Comisiones (EV)")
  m.addBullet(
    "Vista Previa Editable antes de Guardar",
    "Al cargar el archivo Excel o imagen del rol mensual en 'Cronograma Tecnicos', el sistema muestra una matriz interactiva agrupada por Sede (Villa, Norte, Ate, Aramburu) donde puedes corregir cualquier turno haciendo clic sobre la celda."
  )
  m.addBullet(
    "Codigos Soportados",
    "Soporta turnos regulares (M, I, T, N), rotaciones entre sedes como M(N), T(V), I(A), descansos (D, L, F, VAC) y el codigo 'EV' para Comisiones o Eventos Especiales en Provincia (los dias con 'EV' exoneran automaticamente al tecnico de marcar asistencia)."
  )

  m.addSectionTitle("5. Vinculacion de PC de Sede (Estacion Oficial)")
  m.addParagraph(
    "Si tu cuenta tiene habilitado el permiso 'Vincular Estacion Fija', veras en la pestana 'Control de Acceso' el generador de Codigos de Un Solo Uso (6 digitos). Solo debes elegir la sede, generar el codigo e ingresarlo haciendo clic en el icono discreto de candado ubicado en la esquina derecha de la barra de estado del portal de asistencia."
  )

  const paths = outputDirs.map((d) =>
    path.join(d, "3_Manual_Admin_General_Multisede.pdf")
  )
  m.save(paths)
}

// ============================================================================
// 4. MANUAL DE ADMINISTRADOR POR SEDE (NIVEL 1)
// ============================================================================
function buildCampusAdminManual(outputDirs: string[]) {
  const m = new ManualBuilder(
    "Manual del Administrador por Sede",
    "Guia operativa para la supervision exclusiva de una sede universitaria asignada",
    "Nivel 1: Admin por Sede",
    COLORS.EMERALD
  )

  m.addSectionTitle("1. Alcance del Rol Administrador por Sede")
  m.addParagraph(
    "El rol 'Admin por Sede' ('ADMIN_SEDE') esta disenado para los responsables que supervisan exclusivamente una sede especifica (por ejemplo: Solo Campus Villa, Solo Campus Norte, Solo Campus Ate o Solo Campus Aramburu)."
  )
  m.addCalloutBox(
    "Filtro Automatico e Inteligente por Sede",
    "Al iniciar sesion en el Dashboard, veras en el panel izquierdo el distintivo verde 'Vista: <Tu Sede Asignada>'. Todas las tablas de asistencia en vivo, graficos de puntualidad, exportaciones de reportes y listas de personal mostraran unica y exclusivamente la informacion de tu sede, sin mezclar datos de otros campus."
  )

  m.addSectionTitle("2. Independencia entre tu Sede de Trabajo y tu Vista de Admin")
  m.addParagraph(
    "Si ademas de ser Administrador por Sede eres Tecnico, Docente o Paciente Simulado, tu sede operativa para marcar asistencia diaria es totalmente independiente de tu configuracion como administrador."
  )

  m.addSectionTitle("3. Tareas Diarias del Administrador por Sede")
  m.addBullet(
    "1. Monitoreo de Asistencia en Tiempo Real (Resumen)",
    "Visualiza al instante quienes han marcado Entrada o Salida hoy en tu sede, su hora exacta y si ingresaron A Tiempo, con Tardanza o Falta."
  )
  m.addBullet(
    "2. Descarga de Reportes de tu Sede (Exportacion)",
    "Filtra por rango de fechas (Hoy, Ultimos 7 dias, Ultimos 30 dias o personalizado) y descarga el reporte en Excel (.xlsx), CSV o PDF oficial. El sistema aplicara automaticamente el filtro de tu sede."
  )
  m.addBullet(
    "3. Gestion del Personal de tu Sede (Personal Operativo)",
    "Registra nuevos docentes, tecnicos o pacientes simulados asignados a tu sede, o actualiza sus datos (DNI, nombre o turno predeterminado)."
  )
  m.addBullet(
    "4. Consulta y Gestion del Cronograma de Tecnicos de tu Sede",
    "Revisa que tecnicos estan programados cada dia en tu sede (incluyendo tecnicos de otras sedes que rotan en apoyo a tu campus)."
  )

  m.addSectionTitle("4. Como Habilitar la PC de Recepcion de tu Sede (Estacion Oficial)")
  m.addParagraph(
    "Para que la computadora fija de tu oficina permita marcar sin requerir GPS:"
  )
  m.addBullet(
    "Opcion A - Con Codigo de Un Solo Uso",
    "Solicita al Super Admin un codigo de 6 digitos para tu sede (o generalo tu mismo desde 'Control de Acceso' si tienes activo el permiso 'Vincular Estacion Fija'). Luego, en la PC de la oficina, haz clic en el pequeno icono de candado ubicado en el extremo derecho de la barra de estado de ubicacion e ingresa los 6 digitos."
  )
  m.addBullet(
    "Opcion B - Con Usuario y Contrasena",
    "Si cuentas con el permiso 'Vincular Estacion Fija', abre el icono de candado en la PC, pulsa 'Cambiar a Usuario y Contrasena ->', selecciona tu sede e ingresa tu DNI y contrasena."
  )

  const paths = outputDirs.map((d) =>
    path.join(d, "4_Manual_Admin_Por_Sede.pdf")
  )
  m.save(paths)
}

// ============================================================================
// 5. MANUAL DEL COORDINADOR DE PACIENTES SIMULADOS (NIVEL 2)
// ============================================================================
function buildPatientCoordinatorManual(outputDirs: string[]) {
  const m = new ManualBuilder(
    "Manual del Coordinador de Pacientes Simulados",
    "Guia especializada para la gestion, monitoreo y exportacion exclusiva de Pacientes Simulados",
    "Nivel 2: Coord. Pacientes Simulados",
    COLORS.PURPLE
  )

  m.addSectionTitle("1. Proposito del Rol Coordinador de Pacientes Simulados")
  m.addParagraph(
    "El rol 'Coordinador de Pacientes Simulados' ('COORDINADOR_PACIENTES') ofrece un entorno de control limpio y enfocado 100% en la gestion de los Pacientes Simulados, ocultando herramientas ajenas a su funcion (como los cronogramas de turnos de tecnicos o las fichas de docentes)."
  )
  m.addCalloutBox(
    "Entorno Exclusivo: Solo Pacientes Simulados",
    "Al ingresar al Dashboard, veras la insignia morada 'Solo Pacientes Simulados'. Tanto las metricas del dia, los graficos de asistencia, el directorio de usuarios como los reportes descargables en Excel y PDF estan filtrados de forma automatica y estricta para mostrar unicamente Pacientes Simulados."
  )

  m.addSectionTitle("2. Alcance de Sedes (Global o por Sede)")
  m.addBullet(
    "Coordinacion Global (Todas las Sedes)",
    "Si tu cuenta fue configurada con alcance Global, podras monitorear y exportar la asistencia de los Pacientes Simulados de las 4 sedes (Villa, Norte, Ate y Aramburu)."
  )
  m.addBullet(
    "Coordinacion por Sede",
    "Si tu cuenta fue asignada a una sede especifica, veras exclusivamente a los Pacientes Simulados de ese campus."
  )

  m.addSectionTitle("3. Funciones Principales Paso a Paso")
  m.addSubTitle("A) Monitoreo de Llegada en Vivo (Pestana Resumen)")
  m.addBullet(
    "Control de Puntualidad y Cursos",
    "Verifica en tiempo real que pacientes simulados ya registraron su ingreso desde su celular (con GPS dentro del campus) o desde la Estacion Oficial de la sede, junto con el curso de simulacion al que asisten."
  )

  m.addSubTitle("B) Directorio de Pacientes Simulados (Pestana Pacientes Simulados)")
  m.addBullet(
    "Registro Individual",
    "Haz clic en el boton verde '+ Anadir Paciente', selecciona 'Individual', escribe el Nombre Completo, DNI (8 digitos) y Sede Base. El rol queda fijado automaticamente como 'Paciente Simulado'."
  )
  m.addBullet(
    "Carga Masiva desde Excel",
    "Haz clic en '+ Anadir Paciente' -> 'Masivamente'. Puedes descargar la plantilla oficial 'Plantilla para Pacientes Simulados' (.xlsx), llenarla con los nombres y DNIs, y subirla en segundos. El sistema registrara a todos automaticamente con el rol de Paciente Simulado."
  )
  m.addBullet(
    "Edicion y Baja",
    "Usa el icono de lapiz para corregir el nombre, DNI o sede de cualquier paciente simulado, o el icono de papelera para darlo de baja."
  )

  m.addSubTitle("C) Exportacion de Reportes de Pacientes Simulados (Pestana Exportacion)")
  m.addBullet(
    "Filtro Bloqueado en Pacientes Simulados",
    "En la seccion de filtros veras el indicador 'Solo Pacientes Simulados'. Puedes elegir el rango de fechas (Hoy, Ultimos 7 dias, Ultimos 30 dias o fechas especificas) y la sede."
  )
  m.addBullet(
    "Formatos de Descarga",
    "Descarga con un clic el consolidado en Excel (.xlsx), CSV o PDF Oficial listo para liquidacion de horas, control de asistencia y auditoria academica."
  )

  const paths = outputDirs.map((d) =>
    path.join(d, "5_Manual_Coordinador_Pacientes_Simulados.pdf")
  )
  m.save(paths)
}

function main() {
  const docsManualsDir = path.join(process.cwd(), "docs", "manuales")
  const publicManualsDir = path.join(process.cwd(), "public", "manuales")
  const targetDirs = [docsManualsDir, publicManualsDir]

  console.log("==================================================")
  console.log("  GENERANDO LOS 5 MANUALES OFICIALES EN PDF")
  console.log("==================================================")

  buildEndUserManual(targetDirs)
  buildSuperAdminManual(targetDirs)
  buildGlobalAdminManual(targetDirs)
  buildCampusAdminManual(targetDirs)
  buildPatientCoordinatorManual(targetDirs)

  // También actualizamos docs/MANUAL_DE_USUARIO_CLINSIM.pdf con el manual de usuario final
  fs.copyFileSync(
    path.join(docsManualsDir, "1_Manual_Usuario_Final_Marcacion_Asistencia.pdf"),
    path.join(process.cwd(), "docs", "MANUAL_DE_USUARIO_CLINSIM.pdf")
  )

  console.log("==================================================")
  console.log("  TODOS LOS MANUALES FUERON GENERADOS CON EXITO")
  console.log("==================================================")
}

main()
